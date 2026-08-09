/* eslint-disable no-console */
import { migrateDown, migrateUp } from './migrator';

/**
 * CLI: pnpm --filter @mir/api migrate:up | migrate:down | migrate:reset
 *
 * Reads DATABASE_MIGRATOR_URL, falling back to DATABASE_URL.
 *
 * The migrator connects as a role that OWNS the tables. The application role
 * (mir_app) deliberately cannot create or alter them — if the app could run
 * DDL, an injection bug could drop a policy (ADR-6).
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  const url = process.env['DATABASE_MIGRATOR_URL'] ?? process.env['DATABASE_URL'];

  if (url === undefined || url === '') {
    console.error('DATABASE_MIGRATOR_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  switch (command) {
    case 'up': {
      const { applied } = await migrateUp(url);
      console.log(applied.length > 0 ? `applied: ${applied.join(', ')}` : 'already up to date');
      break;
    }
    case 'down': {
      const { applied } = await migrateDown(url);
      console.log(applied.length > 0 ? `reverted: ${applied.join(', ')}` : 'nothing to revert');
      break;
    }
    case 'reset': {
      const down = await migrateDown(url, { all: true });
      console.log(`reverted: ${down.applied.join(', ') || 'none'}`);
      const up = await migrateUp(url);
      console.log(`applied: ${up.applied.join(', ') || 'none'}`);
      break;
    }
    default:
      console.error(`unknown command: ${command} (expected up | down | reset)`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
