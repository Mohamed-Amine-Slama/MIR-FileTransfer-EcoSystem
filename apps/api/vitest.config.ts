import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    // RLS and upload tests talk to a real Postgres and real files; they are
    // slower than unit tests and must not be silently killed by a short
    // default timeout, which would look like a flake rather than a failure.
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // Bound the worker count. Each worker opens its own test database and
    // several connection pools; unbounded workers on a many-core machine
    // exhaust PostgreSQL's max_connections, and the symptom is a beforeAll
    // that cannot connect — which Vitest reports as SKIPPED tests, not failed
    // ones. A silently skipped row-level-security test is indistinguishable
    // from a passing one in a green build.
    maxWorkers: 4,
    minWorkers: 1,
  },
  plugins: [
    // Vitest's esbuild transform supports `experimentalDecorators` but NOT
    // `emitDecoratorMetadata`, which NestJS needs for type-based constructor
    // injection. Without SWC here, DI silently resolves to `undefined` at test
    // time and every provider-backed test fails for a reason that looks
    // unrelated to the cause.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
