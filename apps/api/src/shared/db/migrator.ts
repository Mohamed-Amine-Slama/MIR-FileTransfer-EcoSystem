import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Minimal forward/backward SQL migration runner (BUILD_SPEC P3.1).
 *
 * Deliberately hand-rolled rather than generated. The RLS policies, role
 * attributes, GRANTs and the gist exclusion constraint are the security model
 * of this system; they must be reviewable as plain SQL in version control, and
 * they must roll back deterministically. A generated-diff migration tool
 * cannot express `NOBYPASSRLS`, `FORCE ROW LEVEL SECURITY`, or a policy body,
 * and would silently drop them on the next regeneration.
 *
 * Each migration is a pair: `NNNN_name.up.sql` and `NNNN_name.down.sql`.
 * Each file wraps itself in BEGIN/COMMIT, so a failed migration leaves no
 * partial state.
 */

/**
 * Locate `apps/api/migrations`.
 *
 * Resolved lazily rather than at module load: the CLI runs as CommonJS (where
 * `__dirname` exists) but the test runner transforms to ES modules (where it
 * does not). Evaluating this eagerly would throw on import under vitest,
 * before any test had a chance to pass an explicit directory.
 */
export function defaultMigrationsDir(): string {
  if (typeof __dirname !== 'undefined') {
    return join(__dirname, '..', '..', '..', 'migrations');
  }
  return join(process.cwd(), 'migrations');
}

export interface Migration {
  id: string;
  name: string;
  upPath: string;
  downPath: string;
}

export function listMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  const files = readdirSync(dir);
  const ups = files.filter((f) => f.endsWith('.up.sql')).sort();

  return ups.map((up) => {
    const base = up.replace(/\.up\.sql$/, '');
    const down = `${base}.down.sql`;
    if (!files.includes(down)) {
      // A migration without a down is a one-way door. The P3.1 gate requires
      // up -> down -> up, so refuse rather than discover it during a rollback.
      throw new Error(`Migration ${base} has no matching ${down}`);
    }
    const idPart = base.split('_')[0];
    if (idPart === undefined) throw new Error(`Migration ${base} has no numeric prefix`);
    return {
      id: idPart,
      name: base,
      upPath: join(dir, up),
      downPath: join(dir, down),
    };
  });
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          text PRIMARY KEY,
      name        text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedIds(client: Client): Promise<Set<string>> {
  const res = await client.query<{ id: string }>('SELECT id FROM _migrations ORDER BY id');
  return new Set(res.rows.map((r) => r.id));
}

export interface MigrateResult {
  applied: string[];
}

/** Apply every migration that has not yet been applied. */
export async function migrateUp(
  connectionString: string,
  dir: string = defaultMigrationsDir(),
): Promise<MigrateResult> {
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await ensureMigrationsTable(client);
    const done = await appliedIds(client);

    for (const migration of listMigrations(dir)) {
      if (done.has(migration.id)) continue;
      const sql = readFileSync(migration.upPath, 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [
        migration.id,
        migration.name,
      ]);
      applied.push(migration.name);
    }
  } finally {
    await client.end();
  }
  return { applied };
}

/**
 * Roll back the most recently applied migration, or every migration when
 * `all` is set.
 */
export async function migrateDown(
  connectionString: string,
  options: { all?: boolean; dir?: string } = {},
): Promise<MigrateResult> {
  const dir = options.dir ?? defaultMigrationsDir();
  const client = new Client({ connectionString });
  await client.connect();
  const reverted: string[] = [];
  try {
    await ensureMigrationsTable(client);
    const migrations = listMigrations(dir);
    const done = await appliedIds(client);

    // Reverse order: a later migration may depend on an earlier one.
    const target = [...migrations].reverse().filter((m) => done.has(m.id));
    const toRevert = options.all === true ? target : target.slice(0, 1);

    for (const migration of toRevert) {
      const sql = readFileSync(migration.downPath, 'utf8');
      await client.query(sql);
      await client.query('DELETE FROM _migrations WHERE id = $1', [migration.id]);
      reverted.push(migration.name);
    }
  } finally {
    await client.end();
  }
  return { applied: reverted };
}
