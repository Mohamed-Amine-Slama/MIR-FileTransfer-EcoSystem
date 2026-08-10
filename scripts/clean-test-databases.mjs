#!/usr/bin/env node
/**
 * Drop leftover per-worker test databases.
 *
 * Each Vitest worker creates its own database (see rls-harness.ts) so parallel
 * suites cannot truncate each other's fixtures. They are namespaced by process
 * id, which makes them collision-proof but also makes them accumulate.
 *
 * Safe by construction: it only ever drops names matching `mir_test_%`. The
 * development database `mir` and anything else are untouched.
 *
 * Run: pnpm db:clean
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `pg` is a dependency of apps/api, not of the repo root, and pnpm's strict
// linking means the root cannot see it. Resolve from the package that owns it
// rather than adding a duplicate root dependency.
const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { Client } = require('pg');

const HOST = process.env.TEST_PG_HOST ?? '127.0.0.1';
const PORT = process.env.TEST_PG_PORT ?? '5433';
const USER = process.env.TEST_PG_SUPERUSER ?? 'postgres';
const PASS = process.env.TEST_PG_SUPERPASS ?? 'postgres';

const client = new Client({
  connectionString: `postgres://${USER}:${PASS}@${HOST}:${PORT}/postgres`,
});

await client.connect();
try {
  const { rows } = await client.query(
    `SELECT datname FROM pg_database WHERE datname LIKE 'mir\\_test\\_%' ESCAPE '\\'`,
  );

  for (const { datname } of rows) {
    // Terminate stragglers first: DROP DATABASE fails while anyone is connected.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [datname],
    );
    await client.query(`DROP DATABASE IF EXISTS "${datname.replace(/"/g, '""')}"`);
    console.log(`dropped ${datname}`);
  }
  console.log(rows.length === 0 ? 'nothing to clean' : `cleaned ${rows.length} database(s)`);
} finally {
  await client.end();
}
