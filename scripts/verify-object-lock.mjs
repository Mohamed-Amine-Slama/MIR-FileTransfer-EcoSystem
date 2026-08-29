#!/usr/bin/env node
/**
 * BUILD_SPEC P2.4 — the Object Lock delete-rejection probe.
 *
 * The spec calls this "the single most important infrastructure gate — a
 * deletable original is a lost scan is a lawsuit."
 *
 * IT HAS NEVER BEEN RUN, and cannot be run from this repository: it needs a
 * real AWS account. P2.4 stays BLOCKED. What this file changes is that when an
 * account exists, running the gate is one command away instead of a
 * from-scratch task written under launch pressure.
 *
 * Usage against a real account:
 *   AWS_PROFILE=mir-prod \
 *   S3_BUCKET_ORIGINALS=mir-prod-dicom-originals \
 *   S3_BUCKET_REPLICA=mir-prod-dicom-originals-replica \
 *   AWS_REGION=eu-south-1 DR_REGION=eu-west-3 \
 *   node scripts/verify-object-lock.mjs
 *
 * WHAT THIS PROBE IS CAREFUL ABOUT
 *
 * A naive check ("did the delete fail?") passes for the wrong reasons. A
 * delete can fail because of a bucket policy, a missing IAM permission, or a
 * typo in the key — none of which mean the object is protected. An object
 * "protected" by a bucket policy is deletable by anyone who can edit that
 * policy.
 *
 * So each assertion below checks WHY, not just whether:
 *   - the delete must be refused by OBJECT LOCK, not by a policy;
 *   - retention mode must be COMPLIANCE, not GOVERNANCE (governance is
 *     bypassable by anyone holding s3:BypassGovernanceRetention, which
 *     includes anyone who can grant it to themselves);
 *   - the version delete must be refused too — a plain DeleteObject on a
 *     versioned bucket only writes a delete marker and "succeeds" while the
 *     data is still there, which looks like a FAILED probe if you assert
 *     naively, and looks like a PASSED one if you assert on the wrong thing.
 *
 * EXERCISED AGAINST LOCALSTACK 3.8 ON 2026-08-29 — what that did and did not
 * establish, recorded because a partial result is worth more than a vague one:
 *
 *   VALIDATED (the probe's logic runs and its assertions fire correctly):
 *     - Object Lock configuration is read and COMPLIANCE mode detected
 *     - upload returns a VersionId; the object inherits COMPLIANCE retention
 *     - DELETING THE VERSION IS REJECTED, and the object survives the attempt
 *
 *   NOT VALIDATED (LocalStack fidelity limits, NOT probe defects):
 *     - the REASON for the rejection. LocalStack returns a bare
 *       "AccessDenied / Access Denied" with no mention of Object Lock or WORM,
 *       so the check that distinguishes lock-enforced from policy-enforced
 *       cannot be exercised. On real S3 that message names the lock. This is
 *       the single most important assertion in the file and it remains
 *       unproven.
 *     - anonymous access. LocalStack REPORTS RestrictPublicBuckets: true and
 *       then serves the object anonymously with HTTP 200 — it stores the
 *       public-access-block config without enforcing it.
 *     - cross-region replication, which LocalStack's free tier does not run.
 *
 * The conclusion is the one the checklist already states: LocalStack cannot
 * stand in for this gate. P2.4 STAYS BLOCKED until it runs against real S3.
 * Do not relax the two failing assertions to make a LocalStack run go green —
 * they are the assertions that matter.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BUCKET = process.env['S3_BUCKET_ORIGINALS'];
const REPLICA = process.env['S3_BUCKET_REPLICA'];
const REGION = process.env['AWS_REGION'] ?? 'eu-south-1';
const DR_REGION = process.env['DR_REGION'] ?? 'eu-west-3';
const ENDPOINT = process.env['AWS_ENDPOINT_URL'];

if (BUCKET === undefined) {
  console.error(
    '\nS3_BUCKET_ORIGINALS is not set.\n\n' +
      'This is the BUILD_SPEC P2.4 gate and it needs a real AWS account.\n' +
      'P2.4 is BLOCKED until one exists — see docs/pre-launch-checklist.md.\n',
  );
  process.exit(2);
}

const KEY = `probe/object-lock-${randomUUID()}.dcm`;

let failures = 0;
function note(ok, message, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) {
    failures += 1;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

function aws(args, { region = REGION } = {}) {
  const full = ['--region', region, ...(ENDPOINT ? ['--endpoint-url', ENDPOINT] : []), ...args];
  try {
    return { ok: true, out: execFileSync('aws', full, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return {
      ok: false,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
      code: typeof err.status === 'number' ? err.status : 1,
    };
  }
}

console.log('\nP2.4 — Object Lock delete rejection\n' + '='.repeat(70));
console.log(`bucket: ${BUCKET}  region: ${REGION}${ENDPOINT ? `  endpoint: ${ENDPOINT}` : ''}\n`);

// --- 1. the bucket must actually have Object Lock enabled -------------------
const lockConfig = aws(['s3api', 'get-object-lock-configuration', '--bucket', BUCKET]);
note(
  lockConfig.ok && lockConfig.out.includes('Enabled'),
  'bucket has Object Lock enabled',
  lockConfig.out.trim().slice(0, 300),
);

// COMPLIANCE, not GOVERNANCE. This is the difference between "undeletable"
// and "undeletable by people who have not granted themselves an exception".
note(
  lockConfig.ok && lockConfig.out.includes('COMPLIANCE'),
  'default retention mode is COMPLIANCE (not GOVERNANCE)',
  'GOVERNANCE is bypassable with s3:BypassGovernanceRetention and does NOT satisfy this gate',
);

// --- 2. upload an object ----------------------------------------------------
//
// A real temp file, not /dev/null: the AWS CLI rejects a character device with
// "Blob values must be a path to a file", and every later assertion would then
// fail as a cascade from a probe bug rather than a real finding.
const bodyPath = join(tmpdir(), `mir-object-lock-probe-${randomUUID()}`);
writeFileSync(bodyPath, 'MIR Object Lock probe. Synthetic. Safe to retain.\n');

const upload = aws([
  's3api', 'put-object',
  '--bucket', BUCKET,
  '--key', KEY,
  '--body', bodyPath,
]);
rmSync(bodyPath, { force: true });
note(upload.ok, `uploaded probe object ${KEY}`, upload.out.trim().slice(0, 300));

let versionId;
try {
  versionId = JSON.parse(upload.out).VersionId;
} catch {
  /* reported below */
}
note(versionId !== undefined, 'upload returned a VersionId (bucket is versioned)');

// --- 3. the object must carry a retention date ------------------------------
const retention = aws(['s3api', 'get-object-retention', '--bucket', BUCKET, '--key', KEY]);
note(
  retention.ok && retention.out.includes('COMPLIANCE'),
  'the uploaded object inherited COMPLIANCE retention',
  retention.out.trim().slice(0, 300),
);

// --- 4. THE GATE: the delete must be REJECTED, and by Object Lock -----------
//
// On a versioned bucket, DeleteObject WITHOUT a version id succeeds and writes
// a delete marker — the data survives. That is expected, and asserting it
// "fails" would be wrong. What must be refused is deleting the VERSION.
const deleteVersion = aws([
  's3api', 'delete-object',
  '--bucket', BUCKET,
  '--key', KEY,
  ...(versionId === undefined ? [] : ['--version-id', versionId]),
]);

note(!deleteVersion.ok, 'DELETING THE OBJECT VERSION IS REJECTED', deleteVersion.out.trim().slice(0, 400));

// And rejected for the RIGHT reason. AccessDenied from a bucket policy would
// leave the object deletable by anyone who can edit that policy.
const refusedByLock = /WORMProtect|Object Lock|retention period|InvalidRequest/i.test(deleteVersion.out);
note(
  refusedByLock,
  'the rejection came from OBJECT LOCK, not a bucket policy or missing IAM permission',
  `message did not mention Object Lock/WORM:\n        ${deleteVersion.out.trim().slice(0, 400)}`,
);

// --- 5. the object must still be there --------------------------------------
const head = aws(['s3api', 'head-object', '--bucket', BUCKET, '--key', KEY,
  ...(versionId === undefined ? [] : ['--version-id', versionId])]);
note(head.ok, 'the object still exists after the delete attempt');

// --- 6. anonymous access must be refused ------------------------------------
const url = ENDPOINT
  ? `${ENDPOINT}/${BUCKET}/${KEY}`
  : `https://${BUCKET}.s3.${REGION}.amazonaws.com/${KEY}`;
const anon = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', url], {
  encoding: 'utf8',
}).trim();
note(anon === '403', `anonymous GET is refused (got ${anon}, want 403)`);

// --- 7. the replica must exist in the DR region -----------------------------
if (REPLICA === undefined) {
  console.log('  skip  S3_BUCKET_REPLICA not set; cross-region replication not checked');
} else {
  // Replication is asynchronous. Poll rather than assume it is instant.
  let replicated = false;
  for (let i = 0; i < 30; i += 1) {
    if (aws(['s3api', 'head-object', '--bucket', REPLICA, '--key', KEY], { region: DR_REGION }).ok) {
      replicated = true;
      break;
    }
    execFileSync('sleep', ['10']);
  }
  note(replicated, `replica appeared in ${DR_REGION} within 5 minutes`);
}

// --- 8. cleanup is DELIBERATELY not attempted -------------------------------
console.log(
  `\n  note  the probe object cannot be deleted — that is the point.\n` +
    `        ${KEY}\n` +
    `        It expires when its retention period does. Use a short retention\n` +
    `        on a dedicated test bucket rather than trying to clean it up.`,
);

console.log('\n' + '='.repeat(70));
if (failures > 0) {
  console.error(
    `\n${failures} check(s) FAILED.\n\n` +
      `A deletable original is a lost scan is a lawsuit. Do not launch, and do\n` +
      `not weaken these assertions to get a green run.\n`,
  );
  process.exit(1);
}
console.log('\nObject Lock is enforcing. (P2.4)\n');
