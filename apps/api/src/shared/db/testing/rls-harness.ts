import { Client, Pool } from 'pg';
import { join } from 'node:path';
import type { Role } from '@mir/contracts';
import { migrateUp } from '../migrator';

/**
 * Test harness for the P3.2 row-level-security gate.
 *
 * The whole point of these tests is that they run against a role with the same
 * privileges the application has in production. Two connections are therefore
 * kept strictly separate:
 *
 *   owner  — superuser. Seeds fixtures. Bypasses RLS, which is exactly why it
 *            must never be used to make an assertion about visibility.
 *   app    — `mir_app`. Non-superuser, non-owner, NOBYPASSRLS. Every assertion
 *            runs here.
 *
 * Using the owner connection to assert "the doctor cannot see this row" would
 * pass no matter how broken the policies were.
 */

const HOST = process.env['TEST_PG_HOST'] ?? '127.0.0.1';
const PORT = process.env['TEST_PG_PORT'] ?? '5433';
const SUPERUSER = process.env['TEST_PG_SUPERUSER'] ?? 'postgres';
const SUPERPASS = process.env['TEST_PG_SUPERPASS'] ?? 'postgres';
const TEST_DB = process.env['TEST_PG_DATABASE'] ?? 'mir_test';

/** Local test-only credential. Never used outside the test database. */
const APP_PASSWORD = process.env['TEST_PG_APP_PASSWORD'] ?? 'mir_app_test_pw';

export const ownerUrl = (db: string): string =>
  `postgres://${SUPERUSER}:${SUPERPASS}@${HOST}:${PORT}/${db}`;

export const appUrl = (db: string = TEST_DB): string =>
  `postgres://mir_app:${APP_PASSWORD}@${HOST}:${PORT}/${db}`;

export interface Harness {
  owner: Pool;
  app: Pool;
  close: () => Promise<void>;
}

/**
 * Create (or recreate) the test database, apply migrations, and give the
 * application role a login for the duration of the test run.
 */
export async function setupTestDatabase(): Promise<Harness> {
  // --- create the database, from the maintenance database -------------------
  const admin = new Client({ connectionString: ownerUrl('postgres') });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (exists.rowCount === 0) {
      // Identifier cannot be parameterised; TEST_DB is not user input.
      await admin.query(`CREATE DATABASE ${JSON.stringify(TEST_DB).replace(/"/g, '"')}`);
    }
  } finally {
    await admin.end();
  }

  // --- migrate -------------------------------------------------------------
  const migrationsDir = join(process.cwd(), 'migrations');
  await migrateUp(ownerUrl(TEST_DB), migrationsDir);

  // --- give mir_app a login for testing ------------------------------------
  // The migration deliberately creates the role NOLOGIN with no password, so
  // no credential is committed (§6). Attaching one is an environment concern:
  // Terraform + Secrets Manager in deployed environments, here in tests.
  const owner = new Pool({ connectionString: ownerUrl(TEST_DB), max: 4 });
  await owner.query(`ALTER ROLE mir_app LOGIN PASSWORD '${APP_PASSWORD}'`);

  const app = new Pool({ connectionString: appUrl(TEST_DB), max: 4 });

  return {
    owner,
    app,
    close: async () => {
      await app.end();
      await owner.end();
    },
  };
}

export interface SessionContext {
  userId: string;
  role: Role;
  /** DECISION D3. Defaults to false — imaging visible only after payment. */
  triageBeforePayment?: boolean;
}

/**
 * Run a callback inside a transaction with the RLS session context set.
 *
 * `set_config(..., true)` is the parameterised equivalent of `SET LOCAL`: the
 * value is scoped to this transaction and reverts on commit or rollback. Using
 * SET LOCAL with string interpolation instead would be an injection vector on
 * the one value an attacker most wants to control — their own user id.
 *
 * The context is set INSIDE the transaction on purpose (P4.2). Setting it
 * outside has no effect on the transaction's queries and silently disables
 * every policy's identity check.
 */
export async function asUser<T>(
  pool: Pool,
  ctx: SessionContext,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_role', ctx.role]);
    await client.query('SELECT set_config($1, $2, true)', [
      'app.triage_before_payment',
      String(ctx.triageBeforePayment ?? false),
    ]);
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Remove all data between tests, as the owner (bypasses RLS). */
export async function truncateAll(owner: Pool): Promise<void> {
  await owner.query(`
    TRUNCATE
      audit_events,
      scheduling_appointment_studies,
      scheduling_appointments,
      scheduling_availability,
      imaging_instances,
      imaging_studies,
      consent_records,
      patients_patients,
      identity_doctor_profiles,
      identity_users
    RESTART IDENTITY CASCADE
  `);
}

// ---------------------------------------------------------------------------
// Fixture builders. All seeding happens on the owner connection.
// ---------------------------------------------------------------------------

let seq = 0;
const uniq = (): string => `${Date.now()}-${++seq}`;

export async function createUser(
  owner: Pool,
  role: Role,
  overrides: { fullName?: string; status?: string } = {},
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO identity_users (keycloak_sub, role, phone_e164, full_name, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      `sub-${n}`,
      role,
      `+2189${n.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      overrides.fullName ?? `Test ${role} ${n}`,
      overrides.status ?? 'active',
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createUser returned no row');
  return row.id;
}

export async function createPatient(
  owner: Pool,
  createdByDoctor: string,
  claimedByUser?: string,
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO patients_patients
       (phone_e164, full_name, date_of_birth, sex, created_by_doctor, claimed_by_user)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [`+2189${n.replace(/\D/g, '').slice(-9)}`, `Patient ${n}`, '1985-06-15', 'M', createdByDoctor, claimedByUser ?? null],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createPatient returned no row');
  return row.id;
}

export async function createStudy(
  owner: Pool,
  patientId: string,
  uploadedBy: string,
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO imaging_studies
       (patient_id, uploaded_by, study_instance_uid, modality, status)
     VALUES ($1, $2, $3, 'CT', 'ready') RETURNING id`,
    [patientId, uploadedBy, `1.3.6.1.4.1.99999.1.${n.replace(/\D/g, '')}`],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createStudy returned no row');
  return row.id;
}

export async function createAppointment(
  owner: Pool,
  patientId: string,
  doctorId: string,
  status: 'pending_payment' | 'authorised' | 'confirmed' | 'cancelled' | 'completed' = 'confirmed',
  startsAt: Date = new Date(Date.now() + 86_400_000),
): Promise<string> {
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const res = await owner.query<{ id: string }>(
    `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [patientId, doctorId, startsAt, endsAt, status],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createAppointment returned no row');
  return row.id;
}

export async function linkStudy(
  owner: Pool,
  appointmentId: string,
  studyId: string,
): Promise<void> {
  await owner.query(
    `INSERT INTO scheduling_appointment_studies (appointment_id, study_id) VALUES ($1, $2)`,
    [appointmentId, studyId],
  );
}

export async function grantConsent(
  owner: Pool,
  patientId: string,
  grantedTo: string,
): Promise<string> {
  const res = await owner.query<{ id: string }>(
    `INSERT INTO consent_records
       (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash)
     VALUES ($1, 'cross_border_transfer', $2, 'v1', 'ar', $3) RETURNING id`,
    [patientId, grantedTo, 'a'.repeat(64)],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('grantConsent returned no row');
  return row.id;
}

export async function revokeConsent(owner: Pool, consentId: string): Promise<void> {
  await owner.query(`UPDATE consent_records SET revoked_at = now() WHERE id = $1`, [consentId]);
}
