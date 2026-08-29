import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Emit a self-contained server (apps/web/Dockerfile runs it directly) with
  // only the traced production dependencies, instead of requiring the full
  // workspace node_modules in the runtime image.
  output: 'standalone',

  // Pin the trace root to the monorepo. Without this, Next walks up and can
  // pick an unrelated lockfile outside the repo as the workspace root.
  // `output: 'standalone'` depends on this too: it decides the directory layout
  // of the emitted bundle, and an unrelated root would omit packages/*.
  outputFileTracingRoot: resolve(here, '../..'),

  // BUILD_SPEC §6 / P14.3: no internal detail in response headers.
  poweredByHeader: false,

  // Transpile workspace packages rather than requiring them to be prebuilt.
  transpilePackages: ['@mir/contracts'],

  /**
   * Cornerstone's DICOM image loader reaches for Node built-ins.
   *
   * `@cornerstonejs/dicom-image-loader` ships an HTJ2K decoder whose module
   * graph imports `fs`, which cannot resolve in a browser bundle. The import
   * is not reachable at runtime in the browser — it belongs to a code path
   * that only executes under Node — but webpack resolves the whole graph
   * statically and fails the build.
   *
   * Stubbing these to `false` for the CLIENT bundle only is the documented
   * fix. The server bundle keeps the real modules, so nothing server-side
   * loses filesystem access.
   */
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },

  /**
   * Route `/api/*` to the API when this build is told where the API is.
   *
   * lib/api/client.ts calls the API at the same origin under `/api`, and the
   * viewer builds `wadors:` ids against the same prefix (P8.2). In a deployed
   * environment Cloudflare owns that routing at the edge (P14.3) and Next never
   * sees the request, so API_ORIGIN is unset there and NO rewrite is emitted —
   * this block must not become a second, divergent copy of the edge's routing
   * table.
   *
   * It exists for the container stack, where compose sets API_ORIGIN to
   * http://api:3000. Same-origin is not a convenience: apiFetch sends
   * `credentials: 'include'`, and splitting the browser across two origins is
   * how those requests start arriving unauthenticated.
   *
   * The prefix is stripped because the API mounts its routes at the root — it
   * declares no global prefix, so /api/health must reach the API as /health.
   *
   * Read at BUILD time, not at container start: `next build` serialises the
   * resolved config into the standalone output. Repointing this means a
   * rebuild, not a restart.
   */
  async rewrites() {
    const apiOrigin = process.env['API_ORIGIN'];
    if (apiOrigin === undefined || apiOrigin === '') return [];

    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },

  async headers() {
    // Baseline security headers. The authoritative set is enforced at the edge
    // by Cloudflare (P14.3); these exist so a local or misconfigured-edge
    // deployment is not bare. Duplication here is intentional defence in depth.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },

          /**
           * Content Security Policy.
           *
           * Built against what this app actually loads, not copied from a
           * template. Two directives are load-bearing for the viewer and must
           * not be tightened without re-running `viewer.spec.ts`:
           *
           * - `'wasm-unsafe-eval'` — Cornerstone's HTJ2K/JPEG decoders are
           *   WebAssembly. This token permits WASM compilation and NOTHING
           *   else; it is specifically not `'unsafe-eval'`, which would also
           *   permit eval() of JavaScript.
           * - `worker-src blob:` — the DICOM image loader decodes frames in
           *   web workers created from blob URLs, and `img-src blob:` because
           *   decoded frames are handed to the canvas the same way.
           *
           * `style-src 'unsafe-inline'` is Next's critical-CSS injection. It
           * is the one genuine weakening here; removing it needs a nonce
           * threaded through the document, which Next's App Router does not
           * make available to a static header.
           */
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },

          // No feature this app uses needs any of these. A compromised script
          // that cannot reach the camera or geolocation is a smaller problem.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
              'magnetometer=(), gyroscope=(), accelerometer=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
