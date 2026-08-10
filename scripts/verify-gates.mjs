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
  ['P2.1', 'terraform plan clean, remote state', 'blocked', 'no AWS account'],
  ['P2.2', 'DB unreachable from internet', 'blocked', 'needs a real connection attempt'],
  ['P2.3', 'Four KMS keys, rotation on', 'blocked', 'no AWS account'],
  ['P2.4', 'Object Lock delete REJECTED', 'blocked', 'MOST IMPORTANT INFRA GATE - never run'],
  ['P2.5', 'Failover + PITR restore', 'blocked', 'RTO/RPO unmeasured'],
  ['P2.6', 'Health check over TLS 1.3', 'blocked', 'no deployment'],
  ['P3.1', 'migrate up/down/up', 'verified', '8 migrations'],
  ['P3.2', 'Seven RLS tests', 'verified', '21 tests, run in CI'],
  ['P3.3', 'Patient identity matching', 'verified', 'no auto-merge, phone only'],
  ['P4.1', 'Keycloak realm + JWT', 'partial', 'realm written; not deployed'],
  ['P4.2', 'JWT validation, RLS in transaction', 'verified', '4 required cases + more'],
  ['P4.3', 'MFA for clinical accounts', 'partial', 'API enforced; Keycloak flow unbound'],
  ['P4.4', 'Audit immutable under tamper', 'verified', 'UPDATE and DELETE both denied'],
  ['P4.5', 'Rate limiting + anomaly alerts', 'partial', 'logic tested; no alert delivery'],
  ['P5.1', 'Patients isolation end-to-end', 'verified', 'through HTTP, 404 not 403'],
  ['P5.2', 'Claim flow single-use tokens', 'verified', 'reuse, expiry, cross-account'],
  ['P5.3', 'Consent evidence + revocation', 'verified', 'text reconstructible; DB-enforced immutability'],
  ['P6.1', 'DICOM validation vs fixtures', 'verified', 'all 7 fixtures'],
  ['P7.1', 'Cross-doctor upload blocked', 'verified', '404, no session row'],
  ['P7.2', 'Interrupted upload resumes', 'partial', 'resume proven; no physically severed link'],
  ['P7.3', 'Queue survives browser kill', 'verified', 'persistent profile, real close'],
  ['P7.4', 'Study integrity under retry', 'verified', '120 files, idempotent, byte-exact'],
  ['P8.1', 'Orthanc private + functional', 'partial', 'local: auth + DICOMweb verified; VPC isolation not'],
  ['P8.2', 'No browser path to Orthanc', 'verified', '404+audit, signed URL 4min/20min, bundle grep'],
  ['P9.1', 'First image <5s, no prefetch', 'verified', '~1.0s; 1 request for 120 instances'],
  ['P10.1', 'Timezone correctness', 'verified', 'Tunis/Tripoli + DST boundary'],
  ['P10.2', '50 concurrent, exactly one wins', 'verified', 'deterministic over 5 rounds'],
  ['P10.3', 'Triage toggle both modes', 'verified', 'enforced at RLS layer too'],
  ['P11.1', 'Payment rail confirmed viable', 'blocked', 'L7 + Stripe entity jurisdiction'],
  ['P11.2', 'Idempotency + out-of-order webhooks', 'verified', '10 replays -> 1 state change'],
  ['P12', 'No clinical data in notifications', 'verified', 'type-level + render-time + vocabulary scan'],
  ['P13', 'Log scrubbing + tracing', 'verified', 'one documented limitation; no collector wired'],
  ['P14.1', 'No standing production access', 'blocked', 'no production'],
  ['P14.2', 'Vulnerable dependency blocks build', 'partial', 'job added; not demonstrated red'],
  ['P14.3', 'Edge protection, headers grade A', 'open', 'Cloudflare not configured'],
  ['P14.4', 'Pen test, high/critical remediated', 'blocked', 'not commissioned - BLOCKS LAUNCH'],
  ['P15.1', 'Backup restore drill', 'open', 'runbook written, not exercised'],
  ['P15.2', 'Region failure drill', 'open', 'runbook written, not exercised'],
  ['P15.3', 'Incident response tabletop', 'open', 'runbook written, not exercised'],
];

const LEGAL = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];

const counts = { verified: 0, partial: 0, open: 0, blocked: 0 };
for (const [, , status] of GATES) counts[status]++;

const mark = { verified: 'OK  ', partial: 'PART', open: 'OPEN', blocked: 'BLKD' };

console.log('\nBUILD_SPEC gate status\n' + '='.repeat(78));
for (const [phase, gate, status, note] of GATES) {
  console.log(
    `${mark[status]}  ${phase.padEnd(6)} ${gate.padEnd(42)}${note ? ' — ' + note : ''}`,
  );
}

console.log('='.repeat(78));
console.log(
  `verified ${counts.verified}   partial ${counts.partial}   ` +
    `open ${counts.open}   blocked ${counts.blocked}   (of ${GATES.length})`,
);
console.log(`\nBLOCKING LEGAL: ${LEGAL.join(' ')} — none answered.`);
console.log('\nNOT LAUNCHABLE. See docs/pre-launch-checklist.md.');
console.log('The blockers are legal and infrastructural, not code.\n');
