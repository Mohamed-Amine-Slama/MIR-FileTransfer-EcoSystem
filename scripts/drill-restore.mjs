#!/usr/bin/env node
/**
 * BUILD_SPEC P15.1 — backup restore drill, actually executed.
 *
 * "Restore the database from PITR into a scratch environment. Verify
 *  referential integrity and that studies remain linked to the right patients."
 *
 * The runbook describing this had never been run. Documented restore
 * procedures are routinely wrong in ways only execution reveals, and the
 * failure mode is that you find out during an incident.
 *
 * What this checks is the gate's actual wording — that studies are still
 * linked to the RIGHT patients — by seeding a manifest of known
 * (patient, study, instance, checksum) tuples and comparing them tuple by
 * tuple after the restore. A row count proves nothing: a restore that
 * shuffled foreign keys would keep every count identical.
 *
 * SCOPE, stated plainly: this is a single-node `pg_basebackup` into a scratch
 * container on developer hardware. It is NOT the managed RDS point-in-time
 * recovery that P2.5 requires, and its RTO must never be quoted as that
 * number. What it does verify is the procedure and the integrity assertions.
 *
 * Run: node scripts/drill-restore.mjs
 * Needs: docker, and the compose postgres container running.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const SOURCE_CONTAINER = process.env['PG_CONTAINER'] ?? 'mir-postgres';
const SCRATCH_CONTAINER = 'mir-restore-drill';
const SCRATCH_PORT = 55433;
const PGUSER = 'postgres';
const PGPASSWORD = 'postgres';
const DB = 'mir';

let failures = 0;
function note(ok, message, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) {
    failures += 1;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

function psql(container, sql, { port, db = DB } = {}) {
  const args = ['exec', '-e', `PGPASSWORD=${PGPASSWORD}`, container, 'psql'];
  if (port !== undefined) args.push('-p', String(port));
  args.push('-U', PGUSER, '-d', db, '-tAc', sql);
  return sh('docker', args).trim();
}

function seconds(start) {
  return ((Date.now() - start) / 1000).toFixed(1);
}

console.log('\nP15.1 — backup restore drill\n' + '='.repeat(70));

// --- 0. clean up any previous run -------------------------------------------
try {
  sh('docker', ['rm', '-f', SCRATCH_CONTAINER], { stdio: 'ignore' });
} catch {
  /* nothing to remove */
}

// --- 1. seed a manifest whose correctness is checkable ----------------------
//
// Not just rows: a KNOWN mapping. After the restore each study must still
// belong to the same patient and carry the same instance checksums.
console.log('\n1. seeding a known manifest');

const doctorId = randomUUID();
const patientIds = [randomUUID(), randomUUID(), randomUUID()];
const manifest = [];

psql(
  SOURCE_CONTAINER,
  `INSERT INTO identity_users (id, keycloak_sub, role, phone_e164, full_name)
   VALUES ('${doctorId}', 'drill-${doctorId}', 'libya_doctor',
           '+2189${String(Date.now()).slice(-8)}', 'Drill Doctor')
   ON CONFLICT DO NOTHING;`,
);

patientIds.forEach((pid, i) => {
  psql(
    SOURCE_CONTAINER,
    `INSERT INTO patients_patients
       (id, phone_e164, full_name, date_of_birth, sex, created_by_doctor)
     VALUES ('${pid}', '+21891${String(Date.now()).slice(-7)}${i}',
             'Drill Patient ${i}', '1980-01-0${i + 1}', 'M', '${doctorId}');`,
  );

  // Two studies per patient, each with instances carrying distinct checksums.
  for (let s = 0; s < 2; s += 1) {
    const studyId = randomUUID();
    const studyUid = `1.2.826.0.1.drill.${i}.${s}.${Date.now()}`;
    psql(
      SOURCE_CONTAINER,
      `INSERT INTO imaging_studies
         (id, patient_id, uploaded_by, study_instance_uid, modality, status)
       VALUES ('${studyId}', '${pid}', '${doctorId}', '${studyUid}', 'CT', 'ready');`,
    );

    for (let n = 0; n < 3; n += 1) {
      const sha = `${i}${s}${n}`.padEnd(64, 'a');
      psql(
        SOURCE_CONTAINER,
        `INSERT INTO imaging_instances
           (id, study_id, sop_uid, series_uid, storage_key, size_bytes, sha256)
         VALUES ('${randomUUID()}', '${studyId}', '${studyUid}.${n}',
                 '${studyUid}.series', 'drill/${studyId}/${n}.dcm', 1024, '${sha}');`,
      );
      manifest.push({ patientId: pid, studyId, studyUid, sha });
    }
  }
});

console.log(`   ${patientIds.length} patients, ${manifest.length} instances`);

// The database must be checkpointed before the base backup, or the most recent
// writes live only in the WAL buffer.
psql(SOURCE_CONTAINER, 'CHECKPOINT;');

// --- 2. back up, timed ------------------------------------------------------
console.log('\n2. pg_basebackup');
const backupStart = Date.now();

sh('docker', ['exec', SOURCE_CONTAINER, 'rm', '-rf', '/tmp/drill-backup']);
sh('docker', [
  'exec',
  '-e',
  `PGPASSWORD=${PGPASSWORD}`,
  SOURCE_CONTAINER,
  'pg_basebackup',
  '-U',
  PGUSER,
  '-D',
  '/tmp/drill-backup',
  '-Fp',
  '-Xs',
  '-c',
  'fast',
]);

const backupSeconds = seconds(backupStart);
console.log(`   backup completed in ${backupSeconds}s`);

// --- 3. restore into a scratch instance, timed ------------------------------
//
// THE RTO CLOCK: from "restore begins" to "accepting connections". That span
// is what an operator experiences during an incident.
console.log('\n3. restoring into a scratch container');
const restoreStart = Date.now();

sh('docker', ['cp', `${SOURCE_CONTAINER}:/tmp/drill-backup`, '/tmp/drill-backup']);

// Start the scratch container with a NO-OP entrypoint rather than postgres.
//
// The obvious approach — boot postgres, stop it, swap the data directory — does
// not work: postgres is PID 1, so stopping it kills the container before the
// restored files can be put in place.
sh('docker', [
  'run',
  '-d',
  '--name',
  SCRATCH_CONTAINER,
  '-e',
  `POSTGRES_PASSWORD=${PGPASSWORD}`,
  '-p',
  `${SCRATCH_PORT}:5432`,
  '--entrypoint',
  'sleep',
  'postgres:16-alpine',
  'infinity',
]);

// Restore to /restore, NOT to /var/lib/postgresql/data: the latter is a
// declared VOLUME in the postgres image and cannot be removed from inside the
// container ("Resource busy"). Nothing requires the data directory to live at
// the image's default path.
const DATA_DIR = '/restore/data';
sh('docker', ['exec', SCRATCH_CONTAINER, 'sh', '-c', `mkdir -p ${DATA_DIR}`]);
sh('docker', ['cp', '/tmp/drill-backup/.', `${SCRATCH_CONTAINER}:${DATA_DIR}/`]);
sh('docker', ['exec', '-u', 'root', SCRATCH_CONTAINER, 'sh', '-c',
  `chown -R postgres:postgres /restore && chmod 700 ${DATA_DIR}`]);
sh('docker', ['exec', '-d', '-u', 'postgres', SCRATCH_CONTAINER, 'sh', '-c',
  `pg_ctl -D ${DATA_DIR} -l /tmp/pg.log start`]);

let ready = false;
for (let i = 0; i < 120; i += 1) {
  try {
    sh('docker', ['exec', SCRATCH_CONTAINER, 'pg_isready', '-U', PGUSER], { stdio: 'ignore' });
    ready = true;
    break;
  } catch {
    sh('sleep', ['1']);
  }
}

const rtoSeconds = seconds(restoreStart);
note(ready, `restored instance is accepting connections (RTO ${rtoSeconds}s)`);
if (!ready) {
  console.error('\nThe restore never came up. That IS the drill result.\n');
  process.exit(1);
}

// --- 4. integrity: the part the gate is actually about ----------------------
console.log('\n4. verifying integrity');

const orphanInstances = psql(
  SCRATCH_CONTAINER,
  `SELECT count(*) FROM imaging_instances i
     LEFT JOIN imaging_studies s ON s.id = i.study_id
     LEFT JOIN patients_patients p ON p.id = s.patient_id
    WHERE s.id IS NULL OR p.id IS NULL;`,
);
note(orphanInstances === '0', 'no orphaned instances (every instance -> study -> patient)',
  `found ${orphanInstances}`);

const orphanLinks = psql(
  SCRATCH_CONTAINER,
  `SELECT count(*) FROM scheduling_appointment_studies sas
     LEFT JOIN scheduling_appointments a ON a.id = sas.appointment_id
     LEFT JOIN imaging_studies s ON s.id = sas.study_id
    WHERE a.id IS NULL OR s.id IS NULL;`,
);
note(orphanLinks === '0', 'no dangling appointment-study links', `found ${orphanLinks}`);

// The exclusion constraint IS the double-booking guarantee (P10.2). A restore
// that dropped it would leave the database silently accepting overlaps.
const exclusion = psql(
  SCRATCH_CONTAINER,
  `SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'scheduling_appointments'::regclass AND contype = 'x';`,
);
note(exclusion === '1', 'booking exclusion constraint survived the restore',
  `found ${exclusion}`);

// A restore that silently dropped RLS is a breach waiting to happen.
const rlsOff = psql(
  SCRATCH_CONTAINER,
  `SELECT coalesce(string_agg(relname, ', '), '') FROM pg_class
    WHERE relrowsecurity = false
      AND relname IN ('imaging_studies','imaging_instances','patients_patients',
                      'consent_records','scheduling_appointments','audit_events');`,
);
note(rlsOff === '', 'row-level security still enabled on every patient-data table',
  `RLS OFF on: ${rlsOff}`);

// THE GATE: studies still linked to the RIGHT patients, checked tuple by
// tuple against the seeded manifest. Counts cannot catch a shuffle.
let mismatches = 0;
for (const entry of manifest) {
  const row = psql(
    SCRATCH_CONTAINER,
    `SELECT s.patient_id || '|' || i.sha256
       FROM imaging_instances i
       JOIN imaging_studies s ON s.id = i.study_id
      WHERE i.study_id = '${entry.studyId}' AND i.sha256 = '${entry.sha}';`,
  );
  if (row !== `${entry.patientId}|${entry.sha}`) mismatches += 1;
}
note(mismatches === 0,
  `all ${manifest.length} seeded instances still map to the right patient and checksum`,
  `${mismatches} mismatched`);

// --- 5. clean up -------------------------------------------------------------
sh('docker', ['rm', '-f', SCRATCH_CONTAINER], { stdio: 'ignore' });
sh('docker', ['exec', SOURCE_CONTAINER, 'rm', '-rf', '/tmp/drill-backup']);
sh('rm', ['-rf', '/tmp/drill-backup']);

console.log('\n' + '='.repeat(70));
console.log(`backup ${backupSeconds}s   restore/RTO ${rtoSeconds}s   ` +
  `${patientIds.length} patients   ${manifest.length} instances`);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed. The restore procedure is NOT sound.\n`);
  process.exit(1);
}
console.log(
  '\nRestore verified. (P15.1, LOCAL single-node basebackup —\n' +
  'NOT the managed RDS PITR figure P2.5 requires; do not quote it as one.)\n',
);
