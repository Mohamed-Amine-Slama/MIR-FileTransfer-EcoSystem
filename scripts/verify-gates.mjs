#!/usr/bin/env node
/**
 * BUILD_SPEC gate status — the honest accounting.
 *
 * Prints which gates were verified by an executed check and which are open.
 * Deliberately simple: it reads the checklist below, which is maintained by
 * hand alongside docs/pre-launch-checklist.md.
 *
 * Why this exists: a green CI run is easily mistaken for "the spec is
 * satisfied". It is not. Most of what remains open cannot be closed by code —
 * it needs legal answers, an AWS account, or a third-party pen test — and
 * that distinction should be one command away, not buried in a document.
 */

const GATES = [
  // phase, gate, status, note
  ['P0.1', 'Decisions D1-D5 recorded', 'verified', 'docs/decisions.md'],
  ['P0.2', 'Synthetic fixtures + CI guard', 'verified', 'guard proven red and green'],
  ['P1.1', 'Both apps build, /health 200', 'verified', ''],
  ['P1.2', 'Test harness, >=3 tests', 'verified', ''],
  ['P1.3', 'CI red then green', 'partial', 'proven locally; never on a real PR'],
  ['P1.4', 'Boundary violation blocked', 'verified', 'self-verifying via boundaries:verify'],
  ['P1.5', 'Undeclared route blocked', 'verified', 'app refuses to boot, never binds port'],
  ['P1.6', 'Config + secret scanning', 'verified', 'gitleaks caught planted credentials'],
  ['P2.1', 'terraform plan clean, remote state', 'blocked', 'no AWS account; fmt/validate/checkov run in CI (194 pass, 0 fail)'],
  ['P2.2', 'DB unreachable from internet', 'blocked', 'needs a real connection attempt'],
  ['P2.3', 'Four KMS keys, rotation on', 'blocked', 'no AWS account'],
  ['P2.4', 'Object Lock delete REJECTED', 'blocked', 'MOST IMPORTANT INFRA GATE - probe written (verify:object-lock); LocalStack cannot prove it, needs real S3'],
  ['P2.5', 'Failover + PITR restore', 'blocked', 'RTO/RPO unmeasured'],
  ['P2.6', 'Health check over TLS 1.3', 'blocked', 'no deployment'],
  ['P3.1', 'migrate up/down/up', 'verified', '8 migrations'],
  ['P3.2', 'Seven RLS tests', 'verified', '21 tests, run in CI'],
  ['P3.3', 'Patient identity matching', 'verified', 'no auto-merge, phone only'],
  ['P4.1', 'Keycloak realm + JWT', 'local', 'realm imported, PKCE auth flow exercised in a browser; local Keycloak, not deployed'],
  ['P4.2', 'JWT validation, RLS in transaction', 'verified', '4 required cases + more'],
  ['P4.3', 'MFA for clinical accounts', 'local', 'doctor forced to CONFIGURE_TOTP, patient not prompted; probe proven by negative control; local Keycloak'],
  ['P4.4', 'Audit immutable under tamper', 'verified', 'UPDATE and DELETE both denied'],
  ['P4.5', 'Rate limiting + anomaly alerts', 'partial', 'logic tested; no alert delivery'],
  ['P5.1', 'Patients isolation end-to-end', 'verified', 'through HTTP, 404 not 403'],
  ['P5.2', 'Claim flow single-use tokens', 'verified', 'reuse, expiry, cross-account'],
  ['P5.3', 'Consent evidence + revocation', 'verified', 'text reconstructible; DB-enforced immutability'],
  ['P6.1', 'DICOM validation vs fixtures', 'verified', 'all 7 fixtures'],
  ['P7.1', 'Cross-doctor upload blocked', 'verified', 'real HTTP 404 through the controller; no session row'],
  ['P7.2', 'Interrupted upload resumes', 'verified', 'TCP RST mid-transfer via proxy; resumed, checksum matched, 5 consecutive runs'],
  ['P7.3', 'Queue survives browser kill', 'verified', 'persistent profile, real close'],
  ['P7.4', 'Study integrity under retry', 'verified', '120 files, idempotent, byte-exact'],
  ['P8.1', 'Orthanc private + functional', 'partial', 'local: auth + DICOMweb verified; VPC isolation not'],
  ['P8.2', 'No browser path to Orthanc', 'verified', '404+audit, signed URL 4min/20min, bundle grep'],
  ['P9.1', 'First image <5s, no prefetch', 'verified', '~985ms isolated; 1 request for 120 instances; Cornerstone lazy-loaded'],
  ['P10.1', 'Timezone correctness', 'verified', 'Tunis/Tripoli + DST boundary'],
  ['P10.2', '50 concurrent, exactly one wins', 'verified', 'deterministic over 5 rounds'],
  ['P10.3', 'Triage toggle both modes', 'verified', 'enforced at RLS layer too'],
  ['P11.1', 'Payment rail confirmed viable', 'blocked', 'L7 + Stripe entity jurisdiction'],
  ['P11.2', 'Idempotency + out-of-order webhooks', 'verified', '10 replays -> 1 state change'],
  ['P12', 'No clinical data in notifications', 'verified', 'type-level + render-time + vocabulary scan'],
  ['P13', 'Log scrubbing + tracing', 'verified', 'one documented limitation; spans ship to a real OTLP collector, redacted on the wire'],
  ['P14.1', 'No standing production access', 'blocked', 'no production'],
  ['P14.2', 'Vulnerable dependency blocks build', 'verified', 'planted minimist@1.2.5, audit went red by advisory id, tree restored'],
  ['P14.3', 'Edge protection, headers grade A', 'partial', 'CSP+headers set and asserted on both apps; Cloudflare WAF/ratelimit unconfigured'],
  ['P14.4', 'Pen test, high/critical remediated', 'blocked', 'not commissioned - BLOCKS LAUNCH'],
  ['P15.1', 'Backup restore drill', 'local', 'basebackup->scratch restore run: RTO 123s, FK+RLS+exclusion+18/18 manifest verified; not RDS PITR'],
  ['P15.2', 'Region failure drill', 'open', 'runbook written, not exercised'],
  ['P15.3', 'Incident response tabletop', 'verified', 'queries executed against seeded data; 4 gaps found and fixed; live multi-person tabletop still open'],
];

const LEGAL = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];

const counts = { verified: 0, local: 0, partial: 0, open: 0, blocked: 0 };
for (const [, , status] of GATES) counts[status]++;

/**
 * `local` — executed and observed against a LOCAL STAND-IN, not the deployed
 * target.
 *
 * It is not `verified`: a local Keycloak realm and a deployed one are
 * different artifacts, and a single-node database restore is not managed PITR.
 * It is not `partial` either — that bucket means "unfinished", and putting
 * executed, observed verification there hides it among work nobody has
 * started, which is the confusion this ledger exists to prevent.
 *
 * A `local` gate MUST name its stand-in in the note. If it cannot say what
 * stood in for what, it is not `local`.
 *
 * `local` never counts toward launchability.
 */
const mark = {
  verified: 'OK  ',
  local: 'LOCL',
  partial: 'PART',
  open: 'OPEN',
  blocked: 'BLKD',
};

console.log('\nBUILD_SPEC gate status\n' + '='.repeat(78));
for (const [phase, gate, status, note] of GATES) {
  console.log(
    `${mark[status]}  ${phase.padEnd(6)} ${gate.padEnd(42)}${note ? ' — ' + note : ''}`,
  );
}

console.log('='.repeat(78));
console.log(
  `verified ${counts.verified}   local ${counts.local}   ` +
    `partial ${counts.partial}   open ${counts.open}   ` +
    `blocked ${counts.blocked}   (of ${GATES.length})`,
);

// The table above is maintained by hand. If a row carries a status that is not
// one of the five, it would be counted nowhere and the summary would quietly
// understate what is open — the exact failure this file exists to prevent.
const summed =
  counts.verified + counts.local + counts.partial + counts.open + counts.blocked;
if (summed !== GATES.length) {
  console.error(
    `\nLEDGER ERROR: statuses sum to ${summed} but there are ${GATES.length} gates.` +
      `\nA gate has an unrecognised status.`,
  );
  process.exit(1);
}
console.log(`\nBLOCKING LEGAL: ${LEGAL.join(' ')} — none answered.`);
console.log('\nNOT LAUNCHABLE. See docs/pre-launch-checklist.md.');
console.log('The blockers are legal and infrastructural, not code.\n');
