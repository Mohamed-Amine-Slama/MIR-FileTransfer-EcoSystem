# MIR — Cross-border medical imaging transfer

Transfer patient MRI/CT imaging from a referring doctor in **Libya** to a
receiving doctor in **Tunisia**, and let the patient book an appointment with
that doctor.

Built to [`BUILD_SPEC.md`](./BUILD_SPEC.md), phase by phase, gate by gate.

---

> ## ⚠️ NOT READY FOR REAL PATIENTS
>
> The application is substantially built and tested. It cannot be launched.
>
> - **All eight legal prerequisites (L1–L8) are unanswered.** L1 decides
>   whether the cross-border transfer is lawful at all.
> - **No infrastructure exists.** Every PHASE 2 gate is open, including the
>   Object Lock verification the spec calls the single most important one.
> - **No penetration test.** The spec is explicit: do not onboard real
>   patients before it.
>
> Run `pnpm verify:gates` for the full accounting, or read
> [`docs/pre-launch-checklist.md`](./docs/pre-launch-checklist.md).

---

## What this is

A **transfer and scheduling service**, not a diagnostic tool. The receiving
doctor performs the diagnostic read on their own validated equipment. The
in-app viewer is reference-only and says so in a banner that cannot be
dismissed.

That distinction is a deliberate design constraint, not a disclaimer: a
product that lets clinicians diagnose from an uncertified viewer falls into
medical-device regulation.

## Quick start

```bash
pnpm install
docker compose up -d postgres redis      # Orthanc and Keycloak also available
cp .env.example .env

pnpm --filter @mir/api migrate:up        # apply migrations
pnpm verify                              # the full pipeline
pnpm verify:gates                        # what is actually verified vs open
```

Requires Node 20+ and Docker. PostgreSQL listens on **5433** to avoid
colliding with a local install.

### Running the apps in containers instead

The quick start above runs the two apps on the host and only the dependencies
in Docker. To run everything in containers:

```bash
docker compose --profile apps up -d --build
```

Web on <http://localhost:3001>, API on <http://localhost:3000>. Migrations run
automatically as a one-shot `migrate` service before the API starts.

Two things about this stack are worth knowing:

- **It is single-origin.** The frontend calls the API at `/api` on its own
  origin, and the `web` image is built with `API_ORIGIN` set so Next rewrites
  that prefix to the API service — the job Cloudflare does at the edge in
  deployed environments (P8.2). Because `next build` bakes the rewrite into its
  standalone output, changing where `/api` points needs a rebuild, not a
  restart.
- **The API connects as `mir_app`, not as a superuser**, so row-level security
  is actually in force (ADR-6). Migration 0002 creates that role `NOLOGIN` with
  no password on purpose, so a `db-grant` service attaches a local development
  password after migrating. Nothing outside this compose file does that, and
  nothing should.

The app services sit behind the `apps` profile, so plain
`docker compose up -d postgres redis` still starts dependencies only and does
not contend for ports 3000 and 3001 with a host `pnpm dev`.

## Layout

```
apps/api        NestJS modular monolith (ADR-1)
apps/web        Next.js, Arabic + French, RTL from day one (D4)
packages/       shared contracts, DICOM utilities
infra/          Terraform (written, never applied), Orthanc, Keycloak
docs/           decisions, threat model, runbooks, pre-launch checklist
test-data/      SYNTHETIC DICOM ONLY (ADR-7)
```

## The properties worth knowing about

**Authorization is enforced twice, independently** (ADR-6). Application RBAC
and PostgreSQL row-level security. The app connects as a non-superuser,
non-owner role with `NOBYPASSRLS`; there is no admin bypass connection. A bug
in one layer does not expose data.

**Originals are immutable** (ADR-4). Uploaded DICOM is stored byte-for-byte
under Object Lock. Nothing re-encodes pixel data, ever. Thumbnails are separate
derived objects.

**Module boundaries are enforced by CI**, and the enforcement is itself
verified — `pnpm boundaries:verify` plants violations and fails if the rules
stop catching them.

**The audit log is append-only at three levels**: no code path, no GRANT, and
an Object Lock archive so a full database compromise cannot rewrite history.

**Uploads assume the network will fail.** Chunked, resumable, durable state in
PostgreSQL; the queue survives a browser kill and resumes with no user action.

## Testing

```bash
pnpm test              # 260 API + 18 dicom-utils + 90 web + 3 contracts
pnpm --filter @mir/web test:e2e   # 52 browser tests, desktop + mobile
```

Verification commands that prove a guard still works, rather than that the tree
currently passes it:

```bash
pnpm boundaries:verify   # plants module-boundary violations, asserts they fail
pnpm scan:verify         # plants a vulnerable dependency, asserts audit goes red
pnpm verify:mfa          # doctor without TOTP cannot log in (needs Keycloak)
pnpm drill:restore       # backup -> scratch restore, integrity verified
pnpm verify:object-lock  # P2.4 probe (needs real AWS credentials)
```

The tests that matter most:

| What | Where |
|---|---|
| Row-level security (21 tests) | `apps/api/src/shared/db/rls.test.ts` |
| Upload resume + integrity | `apps/api/src/modules/imaging/upload.test.ts` |
| Browser-kill resume | `apps/web/e2e/upload-resume.spec.ts` |
| 50-concurrent booking | `apps/api/src/modules/scheduling/scheduling.test.ts` |
| Log scrubbing | `apps/api/src/shared/observability/log-scrubber.test.ts` |
| Severed-TCP upload resume | `apps/api/src/modules/imaging/upload-severed.test.ts` |

## Known gaps

Beyond the legal and infrastructure blockers above:

- **Full-fidelity rendering is unproven against a real Orthanc.** Cornerstone3D
  is installed and wired (lazy-loaded after first paint, `wadors:` image ids
  routed through the API proxy, metadata provider registered, window presets).
  The load ordering and safe degradation are covered by e2e tests, but an
  actual 16-bit frame has never been rendered end-to-end — that needs Orthanc
  serving real WADO-RS frames.
- **The CSP carries `script-src 'unsafe-inline'`.** Next's App Router streams
  RSC payloads through inline scripts, and these routes are statically
  prerendered so a per-request nonce cannot reach them. Removing it means
  forcing dynamic rendering app-wide. The app contains no
  `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`, and that
  claim is enforced by a test rather than a comment.
- **No notification delivery provider** is wired. Templates and the
  no-clinical-data guarantee are built and tested.
- **A patient name in free-text logs cannot be scrubbed** when there is no
  accompanying field to learn it from. Recorded as a passing test so it is not
  mistaken for coverage.

## Development note

This repository lives on `/mnt/c` (a Windows drive) under OneDrive. That makes
`node_modules` operations slow (~40s API boot instead of ~2s) and has caused
`EACCES` failures during installs from OneDrive file locks. **Moving it to the
Linux filesystem is strongly recommended.**
