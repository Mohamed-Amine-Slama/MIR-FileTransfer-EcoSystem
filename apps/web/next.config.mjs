import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Pin the trace root to the monorepo. Without this, Next walks up and can
  // pick an unrelated lockfile outside the repo as the workspace root.
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
        ],
      },
    ];
  },
};

export default nextConfig;
