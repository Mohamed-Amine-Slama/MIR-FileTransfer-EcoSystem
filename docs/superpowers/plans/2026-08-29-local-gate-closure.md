# Local Gate Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every BUILD_SPEC gate that is unverified because nobody ran the verification, and refuse to close the ones that need an AWS account, a vendor, or a lawyer.

**Architecture:** Additive. Twelve independent tasks, each ending in an executed verification whose output is observed and recorded in `scripts/verify-gates.mjs`. One task builds missing product code (the upload HTTP transport); the rest add verification harnesses, configuration, and drill records. No existing module boundaries change.

**Tech Stack:** TypeScript, NestJS 11, Next.js 15, Vitest 3, Playwright 1.49, PostgreSQL 16, Keycloak 26, Docker Compose, Terraform, Node 20.

**Spec:** `docs/superpowers/specs/2026-08-29-local-gate-closure-design.md`

## Global Constraints

- **A gate moves only when its verification was executed and its output observed.** Reading configuration is not observation. This is the repository's existing rule; it is not relaxed for any task here.
- **`local` status** means: executed and observed against a local stand-in rather than the deployed target. It never counts toward launchability. Its note must name the stand-in and what remains.
- **Nine gates stay `blocked`:** P2.1, P2.2, P2.3, P2.4, P2.5, P2.6, P11.1, P14.1, P14.4. No task may move them.
- **L1–L8 stay unanswered.** No task may imply otherwise.
- **`NOT LAUNCHABLE`** must remain the closing verdict of `pnpm verify:gates`, and the README's warning block must remain.
- TypeScript strict everywhere: `strict: true`, `noUncheckedIndexedAccess: true`.
- Every controller route handler declares `@RequiresRole(...)` or `@PublicEndpoint()`. The app asserts this at boot (`assertAllRoutesDeclareAccess`) and refuses to listen otherwise.
- All IDs are UUIDv7. All timestamps `timestamptz` in UTC.
- Module boundary rules (P1.4) are enforced by `pnpm boundaries`. `shared/` must not import from `modules/`.
- Never re-encode DICOM pixel data (ADR-4, ADR-5). Test fixtures are synthetic only (ADR-7).
- Commit after every task. Run `pnpm verify:gates` after any task that changes gate status.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `.gitattributes` | Line-ending policy; protects the binary fixture corpus | 1 |
| `SECURITY.md` | Real disclosure policy replacing the GitHub template | 1 |
| `scripts/verify-gates.mjs` | Gate ledger; gains the `local` status | 2, 12 |
| `docs/pre-launch-checklist.md` | Human-readable ledger; gains 🏠 vocabulary | 2, 12 |
| `scripts/verify-dependency-scanning.mjs` | P14.2 red/green proof | 3 |
| `apps/api/src/modules/imaging/internal/uploads.controller.ts` | The missing P7 HTTP transport | 4 |
| `apps/api/src/modules/imaging/uploads.controller.test.ts` | P7.1 gate over real HTTP | 4 |
| `apps/api/src/modules/imaging/upload-severed.test.ts` | P7.2 severed-connection proof | 5 |
| `apps/api/src/shared/http/security-headers.middleware.ts` | API security headers | 6 |
| `apps/web/next.config.mjs` | Web CSP and header set | 6 |
| `apps/api/src/shared/http/security-headers.test.ts` | Header assertions | 6 |
| `.github/workflows/ci.yml` | Wire new checks | 3, 6, 7 |
| `infra/keycloak/configure-mfa.sh` | Rewritten conditional-MFA configuration | 8 |
| `scripts/verify-keycloak-mfa.mjs` | P4.3 behavioural verification | 8 |
| `scripts/drill-restore.mjs` | P15.1 restore drill | 9 |
| `docs/runbooks/dr.md` | Measured local RTO | 9 |
| `docker-compose.yml` | OTLP collector service | 10 |
| `scripts/verify-object-lock.mjs` | P2.4 probe (stays blocked) | 11 |
| `docs/runbooks/incident-response.md` | Tabletop record appendix | 12 |

---

### Task 1: Housekeeping — line endings, fixture integrity, security policy

Prerequisite for everything else. Without `.gitattributes`, every later commit is tangled with CRLF noise.

**Files:**
- Create: `.gitattributes`
- Modify: `test-data/dicom/05-not-dicom/actually-a-png.dcm`
- Modify: `SECURITY.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree. Later tasks assume `git status` is meaningful.

- [ ] **Step 1: Confirm the fixture corruption before changing anything**

```bash
git show HEAD:test-data/dicom/05-not-dicom/actually-a-png.dcm | xxd | head -1
```

Expected: `00000000: 8950 4e47 0a1a 0a54 ...` — the committed blob has `0a1a 0a` where a PNG signature requires `0d0a 1a0a`. Record this output; it is the evidence for the commit message.

- [ ] **Step 2: Write `.gitattributes`**

```gitattributes
# Text files are normalised to LF in the repository regardless of platform.
# This repo lives on a Windows drive under OneDrive; without this, every
# checkout rewrites line endings and every diff is noise.
* text=auto eol=lf

# The fixture corpus is BINARY and must never be normalised.
#
# `actually-a-png.dcm` was committed with the \r stripped from inside its PNG
# magic bytes, because it is mostly ASCII and git's text heuristic guessed
# wrong. The 28 real .dcm binaries survived only because they contain NUL
# bytes and the heuristic guessed right. Nothing enforced that. A byte-mangled
# DICOM fixture is an ADR-4 violation inside the test corpus.
test-data/** binary

# Lockfiles: text, but never merged by line.
pnpm-lock.yaml -diff

# Shell scripts must keep LF or they will not execute in a container.
*.sh text eol=lf
```

- [ ] **Step 3: Restore the PNG fixture's true signature**

The fixture is generated by `test-data/generate-fixtures.mjs`. Regenerate only this file rather than hand-patching bytes:

```bash
node test-data/generate-fixtures.mjs
git diff --stat test-data/
```

Expected: `actually-a-png.dcm` differs from HEAD. Verify the working-tree bytes are now correct:

```bash
xxd test-data/dicom/05-not-dicom/actually-a-png.dcm | head -1
```

Expected: `00000000: 8950 4e47 0d0a 1a0a ...`

If `generate-fixtures.mjs` does not produce a correct PNG signature, that is a bug in the generator — fix the generator, not the file.

- [ ] **Step 4: Renormalise the tree**

```bash
git add --renormalize .
git status --short | wc -l
```

Expected: the 28 phantom-modified files resolve. Confirm no content changed:

```bash
git diff --cached --stat | tail -1
```

Expected: `actually-a-png.dcm` plus `.gitattributes` plus `SECURITY.md`; the previously-listed 28 CRLF-only files should now show no diff.

- [ ] **Step 5: Verify the fixture guard and DICOM tests still pass**

```bash
pnpm check:synthetic
pnpm --filter @mir/dicom-utils test
```

Expected: both pass. The PNG fixture must still be *rejected* by the magic-byte check — it is the "renamed non-DICOM" fixture and rejection is its purpose (P6.1).

- [ ] **Step 6: Replace `SECURITY.md`**

Current content is the unedited GitHub template listing supported versions `5.1.x` and `4.0.x` for a project at `0.1.0`. Replace with:

```markdown
# Security policy

## Reporting a vulnerability

Report privately to **<security contact — see repository owner>**. Do not open
a public issue for a suspected vulnerability in access control, authentication,
or data handling.

Include: what you did, what happened, what you expected, and — if it touches
authorization — which two accounts or roles were involved. We will acknowledge
within three working days.

There is no bug bounty. This is a pre-launch project with no real patient data.

## Scope

This repository holds the application, its infrastructure-as-code, and
**synthetic DICOM fixtures only** (ADR-7). No real patient data exists in any
environment, and none may be copied into one.

## Status — read before relying on anything here

**This application has not been penetration tested** (BUILD_SPEC P14.4), and no
infrastructure has been provisioned. It is not deployed and must not be used
with real patient data. `pnpm verify:gates` prints the current accounting of
what is verified and what is not.

## What is verified

Two independent authorization layers (application RBAC and PostgreSQL
row-level security, ADR-6), an append-only audit log, immutable original
bytes, and log scrubbing — each covered by tests that run in CI. Run
`pnpm verify:gates` for the specifics rather than trusting this paragraph.

## Supported versions

Pre-release. Only `main` receives fixes.
```

Leave the contact as a placeholder marker only if the repository owner has not
published one; if `docs/` names a security contact anywhere, use that instead.

- [ ] **Step 7: Verify nothing broke**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add .gitattributes SECURITY.md test-data/
git commit -m "Add .gitattributes, restore the corrupted PNG fixture, write a real SECURITY.md

The committed PNG fixture had its signature mangled to 89504e47 0a1a0a --
git's text heuristic classified it as text and stripped the \r from inside
the magic bytes. No .gitattributes existed, so the 28 real .dcm binaries
survived only by the heuristic guessing right. test-data/** is now binary.

SECURITY.md was the unedited GitHub template."
```

---

### Task 2: Ledger gains the `local` status

**Files:**
- Modify: `scripts/verify-gates.mjs:14-70` (the `GATES` table and the counting/rendering below it)
- Modify: `docs/pre-launch-checklist.md:9-17` (the "How to read this" legend)

**Interfaces:**
- Produces: status string `'local'`, render mark `'LOCL'`. Tasks 4–12 set gate statuses using these exact strings.

- [ ] **Step 1: Add the status to the counts and marks**

In `scripts/verify-gates.mjs`, change:

```js
const counts = { verified: 0, partial: 0, open: 0, blocked: 0 };
for (const [, , status] of GATES) counts[status]++;

const mark = { verified: 'OK  ', partial: 'PART', open: 'OPEN', blocked: 'BLKD' };
```

to:

```js
const counts = { verified: 0, local: 0, partial: 0, open: 0, blocked: 0 };
for (const [, , status] of GATES) counts[status]++;

/**
 * `local` — executed and observed against a LOCAL STAND-IN, not the deployed
 * target. It is not `verified`: a local Keycloak realm and a deployed one are
 * different artifacts. It is not `partial` either, because that bucket means
 * "not finished" and would hide executed work among work nobody has started.
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
```

- [ ] **Step 2: Add it to the summary line**

Change:

```js
console.log(
  `verified ${counts.verified}   partial ${counts.partial}   ` +
    `open ${counts.open}   blocked ${counts.blocked}   (of ${GATES.length})`,
);
```

to:

```js
console.log(
  `verified ${counts.verified}   local ${counts.local}   ` +
    `partial ${counts.partial}   open ${counts.open}   ` +
    `blocked ${counts.blocked}   (of ${GATES.length})`,
);
```

- [ ] **Step 3: Add a total-integrity assertion**

The table is hand-maintained and the counts must sum. Append after the summary line:

```js
const summed =
  counts.verified + counts.local + counts.partial + counts.open + counts.blocked;
if (summed !== GATES.length) {
  console.error(
    `\nLEDGER ERROR: statuses sum to ${summed} but there are ${GATES.length} gates.` +
      `\nA gate has an unrecognised status.`,
  );
  process.exit(1);
}
```

- [ ] **Step 4: Run it and observe the output**

```bash
node scripts/verify-gates.mjs
```

Expected: renders as before with `local 0` in the summary, no ledger error, and the closing `NOT LAUNCHABLE` verdict unchanged.

- [ ] **Step 5: Add the vocabulary to the checklist**

In `docs/pre-launch-checklist.md`, in the "How to read this" list, insert between the ✅ and ⬜ entries:

```markdown
- 🏠 **Local** — the verification was executed and its output observed, but
  against a local stand-in rather than the deployed target. Real evidence;
  not a substitute for the real environment. Never counts toward launch.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-gates.mjs docs/pre-launch-checklist.md
git commit -m "Add a fifth gate status, local, for executed-against-a-stand-in

Verification run against local Keycloak or local Postgres is not 'verified' --
the deployed artifact differs. But calling it 'partial' buries executed work
in the same bucket as work nobody has started, which is the confusion this
ledger exists to prevent. Never counts toward launchability."
```

---

### Task 3: P14.2 — prove the dependency scanner goes red

**Files:**
- Create: `scripts/verify-dependency-scanning.mjs`
- Modify: `package.json` (add `scan:verify` script)
- Modify: `.github/workflows/ci.yml` (the `vulnerabilities` job, after line 143)

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm scan:verify`, exit 0 on success.

**Why:** CI runs `pnpm audit --audit-level high` and it passes, which proves the tree is clean and proves nothing about the check. A threshold quietly raised, or a scanner pointed at the wrong path, passes forever while enforcing nothing. This is the failure `verify-boundary-enforcement.mjs` already guards against for module boundaries; read that script first — this one follows its shape deliberately.

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Verifies that the P14.2 dependency scan actually blocks a vulnerable package.
 *
 * `pnpm audit` passing proves the dependency tree is currently clean. It does
 * NOT prove the check works. A severity threshold raised to `critical`, a
 * scanner pointed at a path with no lockfile, or an `|| true` appended in CI
 * all leave the job green while enforcing nothing — invisible precisely
 * because green looks like health.
 *
 * So this plants a package with a known high-severity advisory, asserts the
 * scanner rejects it BY ADVISORY ID, removes it, and asserts clean again.
 *
 * Run: node scripts/verify-dependency-scanning.mjs   (wired into CI)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'package.json');
const LOCKFILE = join(REPO, 'pnpm-lock.yaml');
const MANIFEST_BACKUP = join(REPO, 'package.json.scanprobe-backup');
const LOCKFILE_BACKUP = join(REPO, 'pnpm-lock.yaml.scanprobe-backup');

/**
 * minimist 1.2.5 — GHSA-xvch-5gv4-984h, prototype pollution, HIGH.
 *
 * Chosen because it is tiny, has no transitive dependencies, and the advisory
 * is long-published and stable. We assert on the ADVISORY ID rather than a
 * CVSS score: scores get revised, and an assertion on "high" would silently
 * weaken if the advisory were rescored.
 */
const PROBE_PACKAGE = 'minimist';
const PROBE_VERSION = '1.2.5';
const PROBE_ADVISORY = 'GHSA-xvch-5gv4-984h';

function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

function backup() {
  copyFileSync(MANIFEST, MANIFEST_BACKUP);
  copyFileSync(LOCKFILE, LOCKFILE_BACKUP);
}

function restore() {
  copyFileSync(MANIFEST_BACKUP, MANIFEST);
  copyFileSync(LOCKFILE_BACKUP, LOCKFILE);
  rmSync(MANIFEST_BACKUP, { force: true });
  rmSync(LOCKFILE_BACKUP, { force: true });
}

function plantVulnerableDependency() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  manifest.devDependencies = {
    ...manifest.devDependencies,
    [PROBE_PACKAGE]: PROBE_VERSION,
  };
  // The pnpm `overrides` block in this repo force-upgrades several packages.
  // If it ever pins minimist, the probe would be silently upgraded out of
  // vulnerability and this script would report a false failure.
  if (manifest.pnpm?.overrides?.[PROBE_PACKAGE] !== undefined) {
    throw new Error(
      `pnpm.overrides pins ${PROBE_PACKAGE}; choose a different probe package.`,
    );
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // Resolve into the lockfile without downloading or linking anything.
  // `pnpm audit` reads the lockfile, so this is all the scanner needs.
  const install = run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile']);
  if (install.code !== 0) {
    throw new Error(`could not resolve the probe dependency:\n${install.output}`);
  }
}

let failures = 0;
const note = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures += 1;
};

console.log('\nP14.2 — dependency scan enforcement\n' + '='.repeat(70));

backup();
try {
  // --- 1. Clean tree must pass -------------------------------------------
  const before = run('pnpm', ['audit', '--audit-level', 'high']);
  note(before.code === 0, 'clean tree: pnpm audit passes');

  // --- 2. Planted vulnerability must be rejected --------------------------
  plantVulnerableDependency();

  const audited = run('pnpm', ['audit', '--audit-level', 'high']);
  note(audited.code !== 0, `planted ${PROBE_PACKAGE}@${PROBE_VERSION}: pnpm audit exits non-zero`);
  note(
    audited.output.includes(PROBE_ADVISORY) || audited.output.includes(PROBE_PACKAGE),
    `pnpm audit names the advisory (${PROBE_ADVISORY}) or package`,
  );

  // --- 3. Trivy, when available, must agree -------------------------------
  const trivyPresent = run('trivy', ['--version']).code === 0;
  if (trivyPresent) {
    const trivy = run('trivy', [
      'fs',
      '--scanners',
      'vuln',
      '--severity',
      'HIGH,CRITICAL',
      '--exit-code',
      '1',
      '--quiet',
      REPO,
    ]);
    note(trivy.code !== 0, 'trivy independently flags the planted dependency');
  } else {
    console.log('  skip  trivy not installed locally; CI installs it');
  }
} finally {
  restore();
}

// --- 4. Removal must return the tree to clean ------------------------------
const after = run('pnpm', ['audit', '--audit-level', 'high']);
note(after.code === 0, 'probe removed: pnpm audit passes again');

const dirty = run('git', ['status', '--porcelain', 'package.json', 'pnpm-lock.yaml']);
note(dirty.output.trim() === '', 'manifest and lockfile restored exactly');

console.log('='.repeat(70));
if (failures > 0) {
  console.error(`\n${failures} check(s) failed. The dependency scan is NOT enforcing.\n`);
  process.exit(1);
}
console.log('\nDependency scanning is enforcing. (P14.2)\n');
```

- [ ] **Step 2: Run it and watch it prove the scanner red**

```bash
node scripts/verify-dependency-scanning.mjs
```

Expected: every check `ok`, exit 0, and the run visibly reports that `pnpm audit` exited non-zero while the probe was planted.

If step "clean tree: pnpm audit passes" FAILS, the repository has a pre-existing high/critical advisory. That is a real finding — fix or document it before continuing; do not weaken the probe to route around it.

- [ ] **Step 3: Confirm the working tree is unchanged**

```bash
git status --porcelain package.json pnpm-lock.yaml
```

Expected: empty. The script must leave no trace; a probe that corrupts the lockfile is worse than no probe.

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `scripts`:

```json
"scan:verify": "node scripts/verify-dependency-scanning.mjs"
```

- [ ] **Step 5: Wire into CI**

In `.github/workflows/ci.yml`, in the `vulnerabilities` job, after the Trivy step, add:

```yaml
      - name: Verify the dependency scan still blocks a vulnerable package
        run: pnpm scan:verify
```

- [ ] **Step 6: Update the ledger**

In `scripts/verify-gates.mjs`, change the P14.2 row to:

```js
  ['P14.2', 'Vulnerable dependency blocks build', 'verified', 'planted minimist@1.2.5, audit went red, tree restored'],
```

Run `node scripts/verify-gates.mjs` and observe `P14.2` now reads `OK`.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-dependency-scanning.mjs package.json .github/workflows/ci.yml scripts/verify-gates.mjs
git commit -m "Prove the dependency scanner actually blocks a vulnerable package (P14.2)

The audit job passing proved the tree was clean and nothing about the check.
Plants minimist@1.2.5 (GHSA-xvch-5gv4-984h), asserts pnpm audit goes red and
names it, restores the manifest and lockfile exactly. Same shape as
verify-boundary-enforcement.mjs, for the same reason."
```

---

### Task 4: P7.0 — build the missing upload HTTP transport

**Files:**
- Create: `apps/api/src/modules/imaging/internal/uploads.controller.ts`
- Create: `apps/api/src/modules/imaging/uploads.controller.test.ts`
- Modify: `apps/api/src/modules/imaging/imaging.module.ts:17` (register the controller)
- Modify: `apps/api/src/main.ts` (raw body for octet-stream chunks)

**Interfaces:**
- Consumes: `UploadService` from `./upload.service` — `createSession({patientId, expectedFileCount}) → {sessionId, expiresAt}`, `registerFile({sessionId, clientFileId, fileName, sizeBytes, sha256, contentEncoding?}) → FileUploadState`, `getFileState(fileId) → FileUploadState`, `appendChunk(...)`, `completeFile(fileId) → {verified: true, sha256}`.
- Produces: HTTP routes `POST /uploads`, `POST /uploads/:sessionId/files`, `GET /uploads/files/:fileId`, `PUT /uploads/files/:fileId/chunks/:chunkIndex`, `POST /uploads/files/:fileId/complete`. Task 5 drives these over a socket.

**Why:** `apps/web/lib/upload/api-client.ts` calls four of these endpoints and none exist. `imaging.module.ts` registers only `DicomWebController` and `StudiesController`. The web app cannot upload against the real API. P7.1 is recorded `verified` for a gate worded "→ 404", but its test asserts a service exception message because there is no HTTP layer to produce a status.

- [ ] **Step 1: Read the service's exact signatures before writing the controller**

```bash
sed -n '1,140p' apps/api/src/modules/imaging/internal/upload.service.ts
sed -n '230,330p' apps/api/src/modules/imaging/internal/upload.service.ts
```

Note the exact parameter shape of `appendChunk` — the controller must pass it through unchanged. Do not guess.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/imaging/uploads.controller.test.ts`. Follow the harness setup in `apps/api/src/modules/patients/patients.e2e.test.ts` (real database, real HTTP via supertest, RLS context from a token). The gate assertion is the second test.

```typescript
describe('P7.1 upload session over HTTP', () => {
  it('creates a session for the doctor own patient', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);

    const res = await request(app.getHttpServer())
      .post('/uploads')
      .set('authorization', `Bearer ${tokenFor(doctor)}`)
      .send({ patientId: patient, expectedFileCount: 3 });

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 404 -- not 403 -- for another doctor's patient (the P7.1 gate)", async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patientOfB = await createPatient(h.owner, doctorB);

    const res = await request(app.getHttpServer())
      .post('/uploads')
      .set('authorization', `Bearer ${tokenFor(doctorA)}`)
      .send({ patientId: patientOfB, expectedFileCount: 1 });

    // 404 not 403: a 403 confirms the patient id is real (BUILD_SPEC §6).
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(patientOfB);

    const rows = await h.owner.query('SELECT id FROM imaging_upload_sessions');
    expect(rows.rowCount).toBe(0);
  });

  it('rejects an unauthenticated session creation with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/uploads')
      .send({ patientId: randomUUID(), expectedFileCount: 1 });

    expect(res.status).toBe(401);
  });

  it('round-trips a file: register, chunk, complete, checksum verified', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const token = tokenFor(doctor);
    const body = randomBytes(48 * 1024);
    const digest = createHash('sha256').update(body).digest('hex');

    const session = await request(app.getHttpServer())
      .post('/uploads')
      .set('authorization', `Bearer ${token}`)
      .send({ patientId: patient, expectedFileCount: 1 });

    const file = await request(app.getHttpServer())
      .post(`/uploads/${session.body.sessionId}/files`)
      .set('authorization', `Bearer ${token}`)
      .send({
        clientFileId: 'f1',
        fileName: 'CT000001.dcm',
        sizeBytes: body.length,
        sha256: digest,
      });
    expect(file.status).toBe(201);

    const chunkSize = file.body.chunkSizeBytes;
    for (let i = 0, offset = 0; offset < body.length; i += 1, offset += chunkSize) {
      const chunk = body.subarray(offset, Math.min(offset + chunkSize, body.length));
      const res = await request(app.getHttpServer())
        .put(`/uploads/files/${file.body.fileId}/chunks/${i}`)
        .set('authorization', `Bearer ${token}`)
        .set('content-type', 'application/octet-stream')
        .send(chunk);
      expect(res.status).toBe(200);
    }

    const done = await request(app.getHttpServer())
      .post(`/uploads/files/${file.body.fileId}/complete`)
      .set('authorization', `Bearer ${token}`);

    expect(done.status).toBe(201);
    expect(done.body.sha256).toBe(digest);
  });

  it('rejects a chunk whose bytes do not match the declared checksum', async () => {
    // Same setup as above, but flip one byte before completing.
    // Expect 400 from completeFile, and the file marked for retry, not ready.
  });
});
```

Fill in the final test body rather than leaving the comment — it mirrors the round-trip test with `body[0] ^= 0xff` applied to the last chunk sent, and asserts `done.status === 400`.

- [ ] **Step 3: Run it and watch it fail for the right reason**

```bash
pnpm --filter @mir/api test -- uploads.controller
```

Expected: FAIL with 404 on every route — because no controller is registered, not because of an assertion. Confirm the failure is "Cannot POST /uploads", which is the point of the task.

- [ ] **Step 4: Write the controller**

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { UploadService, type FileUploadState } from './upload.service';

/**
 * Resumable upload transport — BUILD_SPEC P7.1/P7.2.
 *
 * Thin by design. Every authorization decision belongs to UploadService and
 * the RLS policies underneath it: uploading for another doctor's patient fails
 * at the database's WITH CHECK policy and surfaces as NotFoundException, which
 * Nest renders as 404 rather than 403 so the endpoint cannot be used to probe
 * which patient ids exist (BUILD_SPEC §6).
 *
 * Chunks arrive as raw application/octet-stream, not multipart: multipart adds
 * encoding overhead and a parse step on both ends for a single opaque blob,
 * and on a constrained Libyan uplink that overhead is real money.
 */

const createSessionSchema = z.object({
  patientId: z.string().uuid(),
  expectedFileCount: z.number().int().positive().max(10_000),
});

const registerFileSchema = z.object({
  clientFileId: z.string().min(1).max(512),
  fileName: z.string().min(1).max(512),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentEncoding: z.enum(['identity', 'gzip']).optional(),
});

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadService) {}

  @RequiresRole('libya_doctor')
  @Post()
  async createSession(
    @Body() body: unknown,
  ): Promise<{ sessionId: string; expiresAt: string }> {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload session request');

    const { sessionId, expiresAt } = await this.uploads.createSession(parsed.data);
    return { sessionId, expiresAt: expiresAt.toISOString() };
  }

  @RequiresRole('libya_doctor')
  @Post(':sessionId/files')
  async registerFile(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<FileUploadState> {
    const parsed = registerFileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid file registration');

    return this.uploads.registerFile({ sessionId, ...parsed.data });
  }

  /**
   * Resume point. The client asks where to continue from after a dropped
   * connection; the answer is authoritative server state, never the client's
   * recollection of what it sent.
   */
  @RequiresRole('libya_doctor')
  @Get('files/:fileId')
  async getFileState(@Param('fileId') fileId: string): Promise<FileUploadState> {
    return this.uploads.getFileState(fileId);
  }

  @RequiresRole('libya_doctor')
  @Put('files/:fileId/chunks/:chunkIndex')
  async appendChunk(
    @Param('fileId') fileId: string,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @Req() req: Request,
  ): Promise<FileUploadState> {
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('Chunk body must be application/octet-stream');
    }
    return this.uploads.appendChunk(fileId, chunkIndex, body);
  }

  @RequiresRole('libya_doctor')
  @Post('files/:fileId/complete')
  async completeFile(
    @Param('fileId') fileId: string,
  ): Promise<{ verified: true; sha256: string }> {
    return this.uploads.completeFile(fileId);
  }
}
```

Adjust `appendChunk`'s call to match the service's real signature from Step 1.

- [ ] **Step 5: Register the controller**

In `apps/api/src/modules/imaging/imaging.module.ts`:

```typescript
import { UploadsController } from './internal/uploads.controller';
```

and change line 17 to:

```typescript
  controllers: [DicomWebController, StudiesController, UploadsController],
```

- [ ] **Step 6: Enable raw bodies for chunk uploads**

In `apps/api/src/main.ts`, after `NestFactory.create`, add:

```typescript
  // Chunk uploads arrive as raw octet-stream and must reach the handler as a
  // Buffer, not a parsed body. Scoped to the chunk route only: making this
  // global would hand every endpoint an unparsed body.
  const express = await import('express');
  app.use(
    '/uploads/files',
    express.raw({ type: 'application/octet-stream', limit: config.UPLOAD_CHUNK_LIMIT_BYTES ?? '16mb' }),
  );
```

If `UPLOAD_CHUNK_LIMIT_BYTES` is not in the config schema, use the literal `'16mb'` and do not invent a config key — the default chunk size is 5 MB per P7.2, so 16mb is headroom, not policy.

- [ ] **Step 7: Run the tests**

```bash
pnpm --filter @mir/api test -- uploads.controller
```

Expected: all pass, including the 404 gate assertion.

- [ ] **Step 8: Confirm the boot-time authorization assertion is satisfied**

```bash
pnpm --filter @mir/api build && pnpm --filter @mir/api test
```

Expected: the whole API suite passes. P1.5's `assertAllRoutesDeclareAccess` runs at boot — if any new route lacked `@RequiresRole`, the app would refuse to listen and tests would fail loudly.

- [ ] **Step 9: Confirm module boundaries still hold**

```bash
pnpm boundaries && pnpm boundaries:verify
```

Expected: both pass.

- [ ] **Step 10: Update the ledger**

P7.1 stays `verified` but its note must stop being wrong:

```js
  ['P7.1', 'Cross-doctor upload blocked', 'verified', 'HTTP 404 over the real controller; no session row'],
```

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/imaging/ apps/api/src/main.ts scripts/verify-gates.mjs
git commit -m "Build the upload HTTP transport that PHASE 7 was missing (P7.0/P7.1)

apps/web/lib/upload/api-client.ts called POST /uploads, POST /uploads/:id/files,
PUT /uploads/files/:id/chunks/:n and POST /uploads/files/:id/complete. None
existed -- imaging.module registered only DicomWebController and
StudiesController, and UploadService was a provider nothing exposed. The web
app could not upload against the real API.

Both test layers had substituted the missing piece: upload.test.ts called the
service in-process, and the e2e spec stubbed the API with page.route().

P7.1's gate says '-> 404'. Its test asserted rejects.toThrow(/not found/i),
because nothing returned HTTP. Now asserted against a real response status."
```

---

### Task 5: P7.2 — sever the connection for real

**Files:**
- Create: `apps/api/src/modules/imaging/upload-severed.test.ts`
- Modify: `docs/runbooks/dr.md` (document the manual `docker network disconnect` variant)

**Interfaces:**
- Consumes: the routes from Task 4.
- Produces: nothing consumed downstream.

**Why:** the gate says *"Do not proceed until you have tested with the network actually severed mid-upload."* The existing test aborts an in-process service call. An aborted call is a clean client-initiated teardown; a dropped link is an RST or a silence. The difference is exactly the bug class this gate exists to find — a half-written chunk, a server that considers a request complete when the client does not, a resume offset computed from either.

- [ ] **Step 1: Write the failing test**

```typescript
import { createServer, connect, type Server, type Socket } from 'node:net';

/**
 * A TCP proxy that can be severed mid-flight.
 *
 * `destroy()` on both sockets sends RST with no FIN — no graceful close, no
 * chance for either side to flush. That is what a dropped mobile link looks
 * like at the transport layer, and it is materially different from an aborted
 * fetch, which is a cooperative teardown the server is told about.
 */
class SeverableProxy {
  private server?: Server;
  private readonly sockets = new Set<Socket>();
  port = 0;

  async listen(targetPort: number): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect(targetPort, '127.0.0.1');
      this.sockets.add(client).add(upstream);
      client.pipe(upstream);
      upstream.pipe(client);
      const drop = () => {
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('error', drop);
      upstream.on('error', drop);
      client.on('close', drop);
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve();
      });
    });
  }

  /** Sever every live connection with an RST. */
  sever(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async close(): Promise<void> {
    this.sever();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

describe('P7.2 upload survives a severed connection', () => {
  it('resumes from server state after the link is cut mid-transfer', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const token = tokenFor(doctor);

    // A 2 MB file: large enough that severing lands mid-transfer, small
    // enough to keep the suite fast.
    const body = randomBytes(2 * 1024 * 1024);
    const digest = createHash('sha256').update(body).digest('hex');

    await app.listen(0);
    const apiPort = app.getHttpServer().address().port;
    const proxy = new SeverableProxy();
    await proxy.listen(apiPort);
    const base = `http://127.0.0.1:${proxy.port}`;

    const session = await postJson(`${base}/uploads`, token, {
      patientId: patient,
      expectedFileCount: 1,
    });
    const file = await postJson(`${base}/uploads/${session.sessionId}/files`, token, {
      clientFileId: 'severed-1',
      fileName: 'CT000001.dcm',
      sizeBytes: body.length,
      sha256: digest,
    });

    const chunkSize = file.chunkSizeBytes;
    const totalChunks = Math.ceil(body.length / chunkSize);
    const severAfter = Math.floor(totalChunks * 0.4);

    let bytesSent = 0;
    let severedError: unknown;

    // --- first attempt: send until the link is cut ------------------------
    try {
      for (let i = 0; i < totalChunks; i += 1) {
        if (i === severAfter) proxy.sever();
        const chunk = body.subarray(i * chunkSize, (i + 1) * chunkSize);
        await putChunk(`${base}/uploads/files/${file.fileId}/chunks/${i}`, token, chunk);
        bytesSent += chunk.length;
      }
    } catch (err) {
      severedError = err;
    }

    // The gate is about a TRANSPORT failure, not an application error.
    expect(severedError).toBeDefined();
    expect(String(severedError)).toMatch(/ECONNRESET|socket hang up|fetch failed|ECONNREFUSED/i);

    // --- resume: ask the server where it actually got to ------------------
    const state = await getJson(`${base}/uploads/files/${file.fileId}`, token);
    expect(state.receivedBytes).toBeGreaterThan(0);
    expect(state.receivedBytes).toBeLessThan(body.length);

    let bytesResent = 0;
    for (let i = state.nextChunkIndex; i < totalChunks; i += 1) {
      const chunk = body.subarray(i * chunkSize, (i + 1) * chunkSize);
      await putChunk(`${base}/uploads/files/${file.fileId}/chunks/${i}`, token, chunk);
      bytesResent += chunk.length;
    }

    const done = await postJson(`${base}/uploads/files/${file.fileId}/complete`, token, {});

    // --- the three things the gate actually requires ----------------------
    expect(done.sha256).toBe(digest);                       // integrity
    expect(bytesResent).toBeLessThan(body.length * 0.75);   // materially less
    expect(bytesSent + bytesResent).toBeLessThan(body.length * 1.5);

    await proxy.close();
    await app.close();
  }, 60_000);
});
```

Write the `postJson` / `putChunk` / `getJson` helpers at the top of the file using `fetch`; they must NOT retry internally, or the severed connection would be papered over before the test observes it.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @mir/api test -- upload-severed
```

Expected: FAIL. Note precisely why — if it fails because resume state is wrong rather than because the test is incomplete, that is a real bug in `UploadService` and it must be fixed rather than accommodated.

- [ ] **Step 3: Make it pass**

No production change should be needed — `UploadService` already tracks `receivedBytes` and `nextChunkIndex` durably in PostgreSQL. If a change IS needed, that is the finding this gate exists to produce: write it in the commit message.

- [ ] **Step 4: Run it repeatedly to confirm determinism**

```bash
for i in 1 2 3 4 5; do pnpm --filter @mir/api test -- upload-severed || break; done
```

Expected: five consecutive passes. A severing test that passes four times in five is not evidence; if it flakes, find the race rather than adding a retry.

- [ ] **Step 5: Document the heavier manual variant**

In `docs/runbooks/dr.md`, under a new `## Severed-link upload drill (P7.2)` heading, record the `docker network disconnect mir_default mir-api` procedure against the compose `apps` profile: closer to a real link failure than an in-process proxy, too slow and too environment-dependent for CI, worth running before any pilot with real clinics.

- [ ] **Step 6: Update the ledger**

```js
  ['P7.2', 'Interrupted upload resumes', 'verified', 'TCP RST mid-transfer via proxy; resumed, checksum matched, 5 runs'],
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/imaging/upload-severed.test.ts docs/runbooks/dr.md scripts/verify-gates.mjs
git commit -m "Sever the TCP connection mid-upload for real (P7.2)

The gate says do not proceed until tested with the network actually severed.
The previous test aborted an in-process service call -- a cooperative teardown
the server is told about. This destroys both sockets of an interposed proxy:
RST, no FIN, which is what a dropped link looks like. Asserts a transport
error, resume from authoritative server state, matching checksum, and
materially fewer bytes re-sent."
```

---

### Task 6: P14.3 — security headers on both apps

**Files:**
- Create: `apps/api/src/shared/http/security-headers.middleware.ts`
- Create: `apps/api/src/shared/http/security-headers.test.ts`
- Modify: `apps/api/src/app.module.ts` (register the middleware)
- Modify: `apps/web/next.config.mjs:81-100` (the `headers()` block)
- Create: `apps/web/e2e/security-headers.spec.ts`

**Interfaces:**
- Produces: `SecurityHeadersMiddleware`, applied to all API routes.

**Why:** the API currently sends no security headers at all — no helmet, nothing in `main.ts`. The web app sends four and **no CSP**. The Cloudflare half of this gate needs an account and stays open; the header set does not.

- [ ] **Step 1: Write the failing API test**

```typescript
describe('P14.3 API security headers', () => {
  const EXPECTED = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  };

  it('sets every expected header on a successful response', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    for (const [header, value] of Object.entries(EXPECTED)) {
      expect(res.headers[header]).toBe(value);
    }
  });

  it('sets them on error responses too', async () => {
    // An error path that skips the headers is the one an attacker reaches.
    const res = await request(app.getHttpServer()).get('/does-not-exist');
    expect(res.status).toBe(404);
    for (const [header, value] of Object.entries(EXPECTED)) {
      expect(res.headers[header]).toBe(value);
    }
  });

  it('does not advertise the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm --filter @mir/api test -- security-headers
```

Expected: FAIL — every header is `undefined`, because the API sets none.

- [ ] **Step 3: Write the middleware**

```typescript
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security headers on every API response — BUILD_SPEC P14.3.
 *
 * The authoritative set is enforced at the edge by Cloudflare in deployed
 * environments. These exist so a local run, a misconfigured edge, or any path
 * that reaches the origin directly is not bare. Duplication is deliberate
 * defence in depth, the same reasoning as next.config.mjs.
 *
 * The CSP is `default-src 'none'` because this is a JSON API: it loads
 * nothing, embeds nothing, and is never a document. A CSP copied from a web
 * app would be strictly weaker for no benefit.
 *
 * Applied as middleware rather than in an interceptor so it also covers error
 * responses — the exception filter short-circuits interceptors, and an error
 * path that skips these headers is the one an attacker reaches.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.removeHeader('X-Powered-By');
    next();
  }
}
```

- [ ] **Step 4: Register it**

In `apps/api/src/app.module.ts`, make `AppModule` implement `NestModule`:

```typescript
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
```

Also call `app.disable('x-powered-by')` in `main.ts` after `NestFactory.create`, so Express never sets it in the first place.

- [ ] **Step 5: Run the API test**

```bash
pnpm --filter @mir/api test -- security-headers
```

Expected: PASS.

- [ ] **Step 6: Add the web CSP**

In `apps/web/next.config.mjs`, extend the `headers()` block. The CSP must be built against what the app actually loads — Cornerstone3D's codecs use web workers and WebAssembly:

```javascript
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Cornerstone's HTJ2K decoders are WASM. 'wasm-unsafe-eval'
              // permits WebAssembly compilation WITHOUT permitting eval() of
              // JavaScript, which is why it exists as a separate token.
              "script-src 'self' 'wasm-unsafe-eval'",
              // Next injects inline styles for its critical CSS.
              "style-src 'self' 'unsafe-inline'",
              // Frames are decoded from blob: URLs by the DICOM image loader.
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
```

- [ ] **Step 7: Write the browser assertion**

Create `apps/web/e2e/security-headers.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

test('every security header is present on a document response', async ({ page }) => {
  const response = await page.goto('/');
  expect(response).not.toBeNull();
  const headers = response!.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['strict-transport-security']).toContain('max-age=');

  // Assert the CSP's DIRECTIVES, not merely that the header exists. A CSP of
  // "default-src *" would pass an existence check and protect nothing.
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).not.toContain('unsafe-eval;');
});
```

- [ ] **Step 8: Verify the CSP does not break the viewer**

```bash
pnpm --filter @mir/web build
pnpm --filter @mir/web test:e2e
```

Expected: all 20 existing e2e tests plus the new one pass. **The viewer tests are the real check here** — a CSP that blocks Cornerstone's workers or WASM breaks rendering, and this is where that surfaces. If `viewer.spec.ts` fails, the policy is wrong; widen the specific directive that is blocking, never fall back to `unsafe-eval`.

- [ ] **Step 9: Update the ledger**

P14.3 moves `open` → `partial`, because the edge half is still unconfigured:

```js
  ['P14.3', 'Edge protection, headers grade A', 'partial', 'CSP+headers set and asserted on both apps; Cloudflare WAF/ratelimit unconfigured'],
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/shared/http/ apps/api/src/app.module.ts apps/api/src/main.ts apps/web/next.config.mjs apps/web/e2e/security-headers.spec.ts scripts/verify-gates.mjs
git commit -m "Set and assert security headers on both apps (P14.3, partial)

The API sent none at all. The web app sent four and no CSP. Both now send a
full set, asserted by test -- directives, not mere presence, so 'default-src *'
could not pass. Applied as middleware rather than an interceptor so error
responses are covered too.

The Cloudflare WAF, edge rate limiting and bot protection still need an
account, so the gate stays partial rather than verified."
```

---

### Task 7: Terraform static validation in CI

**Files:**
- Modify: `.github/workflows/ci.yml` (new `terraform` job)

**Interfaces:** none.

**Why:** ~2,700 lines of infrastructure nobody can apply. This closes **no gate** — it is hygiene, so the config does not rot before the account exists. Record it as such and do not move any P2 status.

- [ ] **Step 1: Verify the tooling locally, if available**

```bash
terraform fmt -check -recursive infra/terraform || echo "formatting drift found"
```

If `terraform` is not installed locally, skip to Step 2 — CI installs it.

- [ ] **Step 2: Add the CI job**

```yaml
  terraform:
    name: Terraform static checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.9.8

      # No AWS account exists (P2.1 is blocked). These are static checks only:
      # fmt and validate need no credentials and no state backend.
      - name: Format
        run: terraform fmt -check -recursive infra/terraform

      - name: Validate each module
        run: |
          set -euo pipefail
          for dir in infra/terraform/modules/*/; do
            echo "==> $dir"
            terraform -chdir="$dir" init -backend=false -input=false
            terraform -chdir="$dir" validate
          done

      - name: Checkov
        uses: bridgecrewio/checkov-action@master
        with:
          directory: infra/terraform
          framework: terraform
          quiet: true
          soft_fail: false
```

- [ ] **Step 3: Fix whatever it finds**

Run the same commands locally if tooling permits. Formatting drift is mechanical (`terraform fmt -recursive infra/terraform`). Checkov findings need judgement: fix real ones; add an inline `#checkov:skip=CKV_AWS_xxx:reason` with a written reason for deliberate choices. **Do not blanket-skip.**

- [ ] **Step 4: Add a ledger note without moving any status**

The P2 rows keep `blocked`. Append to the P2.1 note only:

```js
  ['P2.1', 'terraform plan clean, remote state', 'blocked', 'no AWS account; fmt/validate/checkov run in CI'],
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/verify-gates.mjs
git commit -m "Add Terraform fmt/validate/checkov to CI

Closes no gate -- P2 stays blocked, no account exists. Stops 2,700 lines of
unappliable infrastructure from rotting silently before it can be applied."
```

---

### Task 8: P4.1/P4.3 — Keycloak conditional MFA, configured and exercised

**Files:**
- Modify: `infra/keycloak/configure-mfa.sh` (rewrite)
- Create: `scripts/verify-keycloak-mfa.mjs`
- Modify: `infra/keycloak/realm-mir.NOTES.md` (record what was verified)

**Interfaces:**
- Produces: `pnpm verify:mfa`, which exits non-zero if a clinical account can complete login without a second factor.

**Why:** the current script does not work. It creates `conditional-user-role` executions but never sets their role config — its own comment says the execution id must be resolved from the flow listing, then never does it. The conditional subflow is created with `provider=registration-page-form`, which is not a subflow provider. It never binds the flow. The result enforces nothing. It has gone unnoticed because the API's independent `AuthGuard` check means the misconfiguration fails closed.

- [ ] **Step 1: Start Keycloak and confirm the realm imports**

```bash
docker compose up -d keycloak
sleep 20
curl -fsS http://localhost:8081/realms/mir/.well-known/openid-configuration | head -c 200
```

Expected: JSON describing the `mir` realm. Note the port is `8081` (`KEYCLOAK_HOST_PORT` in `.env`), not the compose default 8080.

- [ ] **Step 2: Confirm the current script produces a flow that enforces nothing**

Run the existing script against the local instance, then inspect what it built:

```bash
TOKEN=$(curl -s -d 'client_id=admin-cli' -d 'username=admin' -d 'password=admin' \
  -d 'grant_type=password' http://localhost:8081/realms/master/protocol/openid-connect/token \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

curl -s -H "authorization: Bearer $TOKEN" \
  http://localhost:8081/admin/realms/mir/authentication/flows | node -pe '
    JSON.parse(require("fs").readFileSync(0)).map(f => f.alias).join("\n")'
```

Record the output. This is the evidence that the rewrite was necessary, and it belongs in the commit message.

- [ ] **Step 3: Rewrite `configure-mfa.sh` against the admin REST API**

Replace the `kcadm` calls with `curl` against the admin REST API, so the script works from outside the container. It must, idempotently:

1. Obtain an admin token from `master` via `admin-cli`.
2. Create top-level flow `mir-browser-conditional-mfa` (`providerId: basic-flow`) if absent.
3. Add executions `auth-cookie` (ALTERNATIVE) and a `forms` subflow containing `auth-username-password-form` (REQUIRED).
4. Create the conditional subflow `mir-clinical-otp` with `type: basic-flow`, requirement `CONDITIONAL`.
5. Add a `conditional-user-role` execution to it, **then PUT its config** with `{ config: { "condUserRole": "<role>" } }` — resolved by re-reading `authentication/flows/{alias}/executions` and matching on `providerId`. This is the step the current script skips.
6. Add `auth-otp-form` as REQUIRED beneath the condition.
7. Repeat 4–6 for each of `libya_doctor`, `tunisia_doctor`, `admin`.
8. Bind the flow: `PUT /admin/realms/mir/` with `browserFlow: "mir-browser-conditional-mfa"`.

Keep the closing note, but rewrite it: the manual steps it lists are now automated, and what remains manual is only the deployed-environment check.

- [ ] **Step 4: Write the behavioural verification**

Create `scripts/verify-keycloak-mfa.mjs`. This is the gate — configuration is not evidence:

```javascript
#!/usr/bin/env node
/**
 * P4.3 gate: a clinical account MUST NOT be able to complete login without a
 * second factor, and a patient account MUST NOT be forced into TOTP.
 *
 * Verified behaviourally against a running Keycloak. Reading the flow's
 * configuration proves nothing: the failure mode this guards against is a flow
 * that LOOKS right and does not fire.
 */
```

It must, against the local realm:

1. Create a throwaway `libya_doctor` user with a password and **no** OTP credential.
2. Attempt a direct-grant token request. **Expect failure** — the account cannot complete authentication without enrolling. Assert the error is about a required action or invalid grant, not a network error.
3. Query `GET /admin/realms/mir/users/{id}` and assert `requiredActions` contains `CONFIGURE_TOTP`.
4. Create a throwaway `patient` user; assert it is NOT given `CONFIGURE_TOTP`.
5. Enrol a TOTP credential for the doctor (generate the secret, compute the code with a TOTP implementation), obtain a token, decode it, and assert `amr` contains `otp` or `acr` > 1.
6. Delete both throwaway users in a `finally`.

Note: `mir-web` disables direct access grants deliberately (see `realm-mir.NOTES.md`). Use a temporary confidential test client created and deleted by the script, or enable direct grants on a throwaway client — never modify `mir-web`.

- [ ] **Step 5: Run the verification and observe every assertion**

```bash
node scripts/verify-keycloak-mfa.mjs
```

Expected: all assertions pass. **If step 2 succeeds in getting a token for a doctor with no OTP, the gate FAILS** — that is the flow failing open, which is worse than today's broken-but-closed script. Fix the flow, do not weaken the assertion.

- [ ] **Step 6: Add the npm script**

In `package.json`: `"verify:mfa": "node scripts/verify-keycloak-mfa.mjs"`

- [ ] **Step 7: Update the ledger — both gates to `local`**

```js
  ['P4.1', 'Keycloak realm + JWT', 'local', 'realm imported and token verified on local Keycloak; deployed realm unverified'],
  ['P4.3', 'MFA for clinical accounts', 'local', 'doctor without TOTP cannot log in, patient not prompted, amr=otp; local Keycloak only'],
```

- [ ] **Step 8: Update the checklist**

In `docs/pre-launch-checklist.md`, the "MFA enforced on all clinical accounts" row moves from ⚠️ partial to 🏠 local, and the "MFA caveat" paragraph is rewritten: the flow is now bound and behaviourally verified against local Keycloak; what remains is the same verification against the deployed realm.

- [ ] **Step 9: Commit**

```bash
git add infra/keycloak/ scripts/verify-keycloak-mfa.mjs package.json scripts/verify-gates.mjs docs/pre-launch-checklist.md
git commit -m "Make the Keycloak conditional-MFA flow actually work, and prove it (P4.1/P4.3)

configure-mfa.sh created conditional-user-role executions and never set their
role config -- its own comment said the execution id had to be resolved from
the flow listing, then never did it. The subflow used registration-page-form,
which is not a subflow provider. The flow was never bound. It enforced nothing.

Unnoticed because AuthGuard independently rejects a clinical token with no
second factor, so the misconfiguration failed closed.

Rewritten against the admin REST API, idempotent. verify-keycloak-mfa.mjs
proves it behaviourally: a doctor with no TOTP cannot obtain a token, a patient
is not prompted, and an enrolled doctor's token carries amr=otp.

local, not verified: this is the compose Keycloak, not a deployed realm."
```

---

### Task 9: P15.1 — run the backup restore drill

**Files:**
- Create: `scripts/drill-restore.mjs`
- Modify: `docs/runbooks/dr.md:15-28` (the "Targets vs. measured" table)

**Interfaces:**
- Produces: `pnpm drill:restore`.

**Why:** the runbook is written and has never been run. Documented restore procedures are routinely wrong in ways only execution reveals. The gate asks to *"verify referential integrity and that studies remain linked to the right patients"* — not that the restore command exited zero.

- [ ] **Step 1: Seed a database with a known, checkable shape**

The drill needs data whose correctness after restore is verifiable, not just countable. Seed: 2 doctors, 3 patients, 4 studies with instances, 2 appointments linking specific studies, and consent rows. Record a manifest of expected `(patient_id, study_id, instance_count, sha256)` tuples before the backup.

- [ ] **Step 2: Take a backup, timing it**

```bash
docker exec mir-postgres pg_basebackup -U postgres -D /tmp/basebackup -Ft -z -Xs -P
```

Record wall-clock duration.

- [ ] **Step 3: Restore into a scratch container, timing it**

Start a second PostgreSQL 16 container on a different port, restore the base backup into it, and start it. Record wall-clock duration from "restore begins" to "accepting connections". **That span is the RTO** for this local drill.

- [ ] **Step 4: Verify integrity — the part that matters**

Against the restored instance, assert:

```sql
-- Every instance still belongs to a study that still belongs to a patient.
SELECT count(*) FROM imaging_instances i
  LEFT JOIN imaging_studies s ON s.id = i.study_id
  LEFT JOIN patients_patients p ON p.id = s.patient_id
  WHERE s.id IS NULL OR p.id IS NULL;
-- Expect 0.

-- Every appointment-study link resolves on both sides.
SELECT count(*) FROM scheduling_appointment_studies sas
  LEFT JOIN scheduling_appointments a ON a.id = sas.appointment_id
  LEFT JOIN imaging_studies s ON s.id = sas.study_id
  WHERE a.id IS NULL OR s.id IS NULL;
-- Expect 0.

-- The exclusion constraint survived the restore.
SELECT conname FROM pg_constraint
  WHERE conrelid = 'scheduling_appointments'::regclass AND contype = 'x';
-- Expect one row.

-- RLS is still enabled on every patient-data table.
SELECT relname FROM pg_class
  WHERE relrowsecurity = false
    AND relname IN ('imaging_studies','imaging_instances','patients_patients',
                    'consent_records','scheduling_appointments','audit_events');
-- Expect 0 rows. A restore that silently drops RLS is a breach waiting.
```

Then compare the seeded manifest against the restored rows tuple by tuple — the gate's actual wording is that studies remain linked to the *right* patients, which a count cannot show.

- [ ] **Step 5: Run the whole drill and record the numbers**

```bash
node scripts/drill-restore.mjs
```

Expected: all integrity assertions pass; the script prints backup duration, restore duration, and measured RTO.

If any assertion fails, that is the drill working. Record the failure and fix the cause.

- [ ] **Step 6: Record the measured RTO honestly**

In `docs/runbooks/dr.md`, in the "Targets vs. measured" table, fill the measured column — with the stand-in named **in the same sentence**:

> Measured **locally** at N seconds (single-node `pg_basebackup` restore into a
> scratch container, on developer hardware, dataset of N rows). This is **not**
> the RDS point-in-time-recovery figure P2.5 requires, and must not be quoted
> as one: managed PITR replays WAL across a far larger dataset and is expected
> to be substantially slower.

- [ ] **Step 7: Update the ledger**

```js
  ['P15.1', 'Backup restore drill', 'local', 'basebackup->scratch restore, FK+RLS+manifest verified, RTO measured; not RDS PITR'],
```

P2.5 stays `blocked`.

- [ ] **Step 8: Commit**

```bash
git add scripts/drill-restore.mjs docs/runbooks/dr.md scripts/verify-gates.mjs package.json
git commit -m "Run the backup restore drill against local Postgres (P15.1)

The runbook had never been executed. Restores a base backup into a scratch
container and verifies what the gate actually asks -- that studies are still
linked to the RIGHT patients -- by comparing a seeded manifest tuple by tuple,
plus FK integrity, the booking exclusion constraint, and that RLS survived.

RTO recorded with the stand-in named in the same sentence. P2.5 stays blocked:
this is not managed PITR."
```

---

### Task 10: P13 — wire a real trace collector

**Files:**
- Modify: `docker-compose.yml` (add `otel-collector`)
- Create: `infra/otel/collector-config.yaml`
- Modify: `apps/api/src/shared/observability/tracing.ts` (OTLP exporter alongside the JSON one)
- Modify: `apps/api/src/shared/observability/tracing.test.ts` (scrubbing on the OTLP path)

**Why:** spans are created, named and scrubbed, and that is tested. The exporter writes JSON to a file; nothing ships. P13's gate was log scrubbing and stays `verified` — but the note "no collector wired" should stop being true, and a second export path is a second place for patient data to escape.

- [ ] **Step 1: Write the failing test first**

The risk is not that traces fail to ship — it is that the OTLP path bypasses the scrubber. Add to `tracing.test.ts`:

```typescript
it('scrubs patient identifiers on the OTLP export path, not only the JSON one', async () => {
  const exported: unknown[] = [];
  const tracer = createTracer(new RecordingOtlpExporter(exported));

  const span = tracer.startSpan('imaging.upload');
  span.setAttribute('patient.name', 'Fatima Al-Mansouri');
  span.setAttribute('authorization', 'Bearer eyJhbGciOiJSUzI1NiJ9.abc.def');
  span.end();

  const serialised = JSON.stringify(exported);
  expect(serialised).not.toContain('Fatima');
  expect(serialised).not.toContain('eyJhbGciOiJSUzI1NiJ9');
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @mir/api test -- tracing
```

- [ ] **Step 3: Add the collector to compose**

A `otel-collector` service (`otel/opentelemetry-collector-contrib`) with an OTLP receiver on 4317/4318 and a `debug` exporter, so a developer can see spans arrive without adding a backend. Put it behind the existing `apps` profile so `docker compose up -d postgres redis` is unaffected.

- [ ] **Step 4: Add the OTLP exporter, routed through the same scrubber**

The scrubber must run **before** the exporter, not inside one exporter. If the current design scrubs inside `JsonSpanExporter`, lift the scrubbing into the span processor so every exporter inherits it — that is the actual fix, and the test above is what forces it.

- [ ] **Step 5: Verify end to end**

```bash
docker compose --profile apps up -d otel-collector api
# drive a request that touches API -> DB -> Orthanc
docker compose logs otel-collector | grep -i "trace_id" | head
```

Expected: spans arrive, sharing one trace id across the API, database and Orthanc calls. Grep the collector's output for a seeded patient name and a token — **neither may appear.**

- [ ] **Step 6: Update the ledger note**

```js
  ['P13', 'Log scrubbing + tracing', 'verified', 'one documented limitation; spans ship to a local OTLP collector, scrubbed on that path too'],
```

- [ ] **Step 7: Commit**

---

### Task 11: P2.4 — write the Object Lock probe (gate stays blocked)

**Files:**
- Create: `scripts/verify-object-lock.mjs`
- Modify: `package.json` (`verify:object-lock`)
- Modify: `infra/terraform/README.md` (how to run it once an account exists)

**Why:** the spec calls this *"the single most important infrastructure gate — a deletable original is a lost scan is a lawsuit."* It cannot be run here. The deliverable is a correct probe, so that when an account exists this is one `AWS_ENDPOINT_URL` away rather than a from-scratch task written under launch pressure.

**This task must NOT move P2.4 off `blocked`.**

- [ ] **Step 1: Write the probe**

It must assert, against `*-dicom-originals`:

1. Upload an object; capture its `VersionId`.
2. `DeleteObject` → assert rejected, **and that the rejection came from Object Lock** (`AccessDenied` with an object-lock reason, or the delete-marker semantics of a versioned bucket), not from a bucket policy or a missing IAM permission. A delete denied for the wrong reason passes a naive check while leaving the object deletable by anyone with the right IAM — this distinction is the whole value of the probe.
3. `DeleteObjectVersion` with the captured version id → assert rejected.
4. `GetObjectRetention` → assert mode is `COMPLIANCE`, not `GOVERNANCE`. Governance mode is bypassable with a privileged call and does not satisfy this gate.
5. Anonymous `GET` of the object URL with no credentials → assert 403.
6. Assert the replica exists in the DR region.

Each assertion prints what it observed, not just pass/fail — the output of this script is the gate's evidence and will be pasted into the checklist.

- [ ] **Step 2: Attempt to exercise it against LocalStack**

```bash
docker run -d --name localstack -p 4566:4566 -e SERVICES=s3 localstack/localstack
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  node scripts/verify-object-lock.mjs
```

**Record honestly what happens.** LocalStack's Object Lock support is partial; compliance-mode retention may not be enforced at all. If the probe's assertions cannot fire meaningfully, that is a finding to write down, not a thing to work around. Do not weaken an assertion to make LocalStack pass.

- [ ] **Step 3: Document the result and how to run it for real**

In `infra/terraform/README.md`, record the exact invocation against a real account, and what the LocalStack attempt did or did not establish.

- [ ] **Step 4: Leave the gate blocked, with a sharper note**

```js
  ['P2.4', 'Object Lock delete REJECTED', 'blocked', 'MOST IMPORTANT INFRA GATE - probe written (verify:object-lock), never run against AWS'],
```

- [ ] **Step 5: Commit**

---

### Task 12: P15.3 — run the incident response tabletop, then reconcile

**Files:**
- Modify: `docs/runbooks/incident-response.md:197` (the "Tabletop exercise (P15.3 — REQUIRED, NOT DONE)" section)
- Modify: `scripts/verify-gates.mjs`, `docs/pre-launch-checklist.md`, `README.md`

**Why:** the gate asks for a tabletop of *"a suspected unauthorized access to one patient's study"*, with gaps logged and fixed. An exercise is something that can genuinely be performed here — and the part that makes it worth doing is **executing the runbook's forensic queries**, because a runbook that says "identify every study this actor accessed" is worthless if the query it gives returns the wrong rows.

- [ ] **Step 1: Seed the scenario**

Against a local database: one `tunisia_doctor` who legitimately accessed two studies, then accessed four more belonging to patients they have no appointment with — some denied by RLS, some granted through a consent that was later revoked. This is the shape of a real insider incident, and it exercises the `granted` distinction the runbook leans on.

- [ ] **Step 2: Walk the runbook as written, executing every query**

Run the three SQL queries in `## First hour → 1. Establish what is actually known` **exactly as written**, against the seeded data. Record for each: did it run, did it return the right rows, was the output usable under pressure.

Known likely findings, to confirm rather than assume:
- The queries use `:actor` / `:patient` named-parameter syntax, which `psql` does not accept — a responder pasting them at 3am gets a syntax error. If so, either give `psql`-compatible `\set` forms or say explicitly which client they are for.
- The runbook never says **which database role** to run them as. `mir_app` is subject to RLS and would return a filtered view of the audit log — precisely the wrong answer during an investigation. Determine what a responder should actually connect as, and write it down.

- [ ] **Step 3: Continue through containment and scope assessment**

Walk sections 2–4. For each instruction, establish whether it is executable as written. `ALTER ROLE mir_app NOLOGIN;` — does the responder have a role that can do that? Keycloak session revocation — is the admin console reachable in the deployed topology the runbook assumes?

- [ ] **Step 4: Fix every gap found**

Amend the runbook. Each fix should be traceable to what the exercise revealed.

- [ ] **Step 5: Record the exercise**

Replace the "REQUIRED, NOT DONE" section with a dated record: scenario, participants (note that this was run by one engineer against a seeded local database, not a live multi-person exercise — that limitation is part of the record), every gap found, and what changed as a result.

- [ ] **Step 6: Update the ledger**

```js
  ['P15.3', 'Incident response tabletop', 'verified', 'exercised against seeded local data; N runbook gaps found and fixed'],
```

- [ ] **Step 7: Reconcile every surface**

```bash
node scripts/verify-gates.mjs
```

Confirm against the spec's §7 projection: **verified 30, local 3, partial 4, open 1, blocked 9, total 47.** If the numbers differ, find out why before proceeding — a mismatch means a task moved a status it should not have.

Then update:
- `docs/pre-launch-checklist.md` — every row touched by tasks 3–12, plus the "Phase completion" table.
- `README.md` — the "Known gaps" section (the collector and upload-transport entries are now wrong) and the test counts. **The `⚠️ NOT READY FOR REAL PATIENTS` block must remain exactly as it is**, because it is still true.

- [ ] **Step 8: Full verification**

```bash
pnpm verify
pnpm verify:gates
```

Expected: green, and the closing verdict still reads `NOT LAUNCHABLE`.

- [ ] **Step 9: Commit**

```bash
git add docs/ scripts/verify-gates.mjs README.md
git commit -m "Run the incident response tabletop and reconcile the ledger (P15.3)

Executed the runbook's forensic queries against seeded data rather than
reading them. Gaps found and fixed. Recorded with its limitation stated: one
engineer against a local database, not a live multi-person exercise.

Ledger now: verified 30, local 3, partial 4, open 1, blocked 9.
Still NOT LAUNCHABLE -- L1-L8 unanswered, no infrastructure, no pen test."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Ledger: fifth status | 2 |
| §2 Housekeeping | 1 |
| §3 P7.0 upload transport | 4 |
| §3 P14.2 | 3 |
| §3 P7.2 | 5 |
| §3 P14.3 | 6 |
| §3 Terraform static validation | 7 |
| §4 P4.1/P4.3 | 8 |
| §4 P15.1 | 9 |
| §4 P13 | 10 |
| §5 P2.4 | 11 |
| §5 P15.3 | 12 |
| §7 Projected outcome reconciliation | 12 step 7 |

No spec section is unimplemented.

**Type consistency:** `FileUploadState` is defined in `upload.service.ts` and used by Task 4's controller and Task 5's test. Status strings `'verified' | 'local' | 'partial' | 'open' | 'blocked'` are established in Task 2 and used unchanged in Tasks 3–12. Route paths declared in Task 4 are the ones Task 5 drives.

**Ordering:** Task 1 must precede all others (clean tree). Task 2 must precede any task that sets a `local` status (8, 9). Task 4 must precede Task 5. Tasks 3, 6, 7, 10, 11 are independent.
