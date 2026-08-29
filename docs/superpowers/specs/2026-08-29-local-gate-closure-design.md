# Local gate closure — design

**Date:** 2026-08-29
**Scope:** BUILD_SPEC gates that are unverified only because nobody ran the
verification, not because running it is impossible from this repository.

---

## Problem

`pnpm verify:gates` reports 27 verified, 7 partial, 4 open, 9 blocked.

The nine blocked gates need an AWS account, a payment rail decision, a pen-test
vendor, or a lawyer. Nothing done here changes them.

The eleven partial and open gates are a different thing, and they have been
quietly conflated with the blocked ones. Several are unverified because the
verification was never executed — not because executing it needs anything this
machine lacks. `P14.2` says *"job added; not demonstrated red"*. `P7.2` says
*"resume proven; no physically severed link"*. Those are undone work, not
blocked work, and the ledger reads the same for both.

This design closes the ones that can be closed, and — equally important —
refuses to close the ones that cannot.

## Non-goals

- Making the application launchable. It is not, and nothing here changes that.
- Building features. The one exception is the missing upload HTTP transport
  (§3, P7.0), which is not a feature so much as the absent half of a phase the
  ledger already claims as verified.
- Closing any P2 infrastructure gate. Terraform stays unapplied.
- Answering L1–L8, or deciding anything L1–L8 depends on.
- Marking a gate verified on the strength of a local stand-in.

---

## §1 Ledger: a fifth status

`verify-gates.mjs` has four statuses. A gate verified against local Keycloak is
not `verified` — the deployed realm is a different artifact and may differ. But
calling it `partial` puts genuinely executed, observed verification in the same
bucket as work nobody has started, which is the confusion this ledger exists to
prevent.

Add `local`, rendered `LOCL`:

> **executed and observed, against a local stand-in rather than the deployed
> target.**

Rules:

- `local` never counts toward launchability. The `NOT LAUNCHABLE` verdict and
  the legal block are unchanged.
- A gate is `local` only if its verification was *run* and its output
  *observed*. Reading configuration is not observation.
- The note must name the stand-in and what remains. "local Keycloak; deployed
  realm unverified" — not "verified locally".

Summary line becomes:

```
verified N   local N   partial N   open N   blocked N   (of 47)
```

`docs/pre-launch-checklist.md` gains the same vocabulary: 🏠 **local**,
between ✅ verified and ⬜ open.

## §2 Housekeeping

Prerequisite, not gate work. Its own commit so the gate diffs stay readable.

**Fixture corruption.** `test-data/dicom/05-not-dicom/actually-a-png.dcm` is
committed with the bytes `89 50 4E 47 0A 1A 0A`. A PNG signature is
`89 50 4E 47 0D 0A 1A 0A`. The file is mostly ASCII, so git's `text=auto`
heuristic classified it as text and stripped the `\r` from inside the magic
bytes. The committed fixture is not a valid PNG.

The P6.1 test still passes — the file is rejected for lacking `DICM` at offset
128, which is what the fixture is for — so this was invisible. It is still a
byte-mangled file in the fixture corpus, and the mechanism that mangled it is
unguarded: the 28 real `.dcm` binaries survived only because they contain NUL
bytes and git guessed right. Nothing enforces that guess.

There is no `.gitattributes` in the repository.

- Add `.gitattributes`: `* text=auto eol=lf`, and `test-data/** binary` so the
  fixture corpus is never normalized again. A byte-mangled DICOM fixture is an
  ADR-4 violation inside the test corpus.
- Restore the PNG fixture's true signature.
- `git add --renormalize .` to settle the 28 files currently showing as
  modified with symmetric CRLF-only diffs (2676 insertions, 2676 deletions, no
  content change).

**`SECURITY.md`** is the unedited GitHub template, listing supported versions
`5.1.x` and `4.0.x` for a project at `0.1.0`. Replace with a real policy:
disclosure contact, scope, response expectation, no bug bounty, and the
statement that no penetration test has been performed (P14.4).

---

## §3 Batch A — gates that close to `verified`

For these, a local run is not a stand-in. It is the thing itself.

### P14.2 — dependency scanning demonstrated red

CI runs `pnpm audit --audit-level high` and Trivy. Both currently pass, which
proves the tree is clean and proves nothing about the check. A scanner wired to
the wrong path, or a severity threshold quietly raised, passes forever while
enforcing nothing — the same failure `verify-boundary-enforcement.mjs` exists to
catch for module boundaries.

`scripts/verify-dependency-scanning.mjs`, modeled on that script:

1. Install a pinned dependency with a known high/critical advisory.
2. Assert `pnpm audit --audit-level high` exits non-zero **and** names the
   advisory — exit code alone would pass if the command failed for an unrelated
   reason.
3. Assert Trivy independently flags it.
4. Remove it; assert both are clean again.

Wired into CI beside `boundaries:verify`. Exposed as `pnpm scan:verify`.

The planted dependency is chosen for a stable, long-published advisory, and the
script asserts on the advisory identifier rather than a CVSS score, which can
be rescored.

### P7.0 — the upload transport does not exist

**Discovered while planning; it changes this section.**

`apps/web/lib/upload/api-client.ts` calls four endpoints:

```
POST /uploads
POST /uploads/:sessionId/files
PUT  /uploads/files/:fileId/chunks/:chunkIndex
POST /uploads/files/:fileId/complete
```

None are implemented. There is no `@Controller('uploads')` in the API, and
`imaging.module.ts:17` registers only `DicomWebController` and
`StudiesController`. `UploadService` is a provider that nothing exposes.

The web app therefore cannot upload against the real API. PHASE 7 — the phase
the spec calls *"⚠️ highest practical risk… this phase determines whether the
product is usable"* — has a client and a service with no wire between them.

Both test layers substitute the missing piece, which is why it stayed
invisible: `upload.test.ts` calls `uploads.createSession(...)` in-process, and
`upload-resume.spec.ts` stubs the API with `page.route()` and its own
`StubServer`. Each is a sound test of what it covers. Neither crosses the gap.

**One ledger entry is consequently wrong.** P7.1 is recorded `verified` for the
gate *"creating a session for another doctor's patient → 404"*. Its test is
named `"blocks a session for ANOTHER doctor's patient, as 404 (the P7.1 gate)"`
and asserts `rejects.toThrow(/not found/i)` — a service exception message.
Nothing returns 404 because nothing returns HTTP. The authorization behaviour
underneath is real and correctly tested; the gate's stated assertion is not the
one being made.

Build the controller: four routes over the existing service, each with a
`@RequiresRole` declaration (P1.5 refuses to boot without one), and a raw
`application/octet-stream` body path for the chunk `PUT` that bypasses the JSON
parser. Error mapping needs no work — `UploadService` already throws
`NotFoundException` and `BadRequestException`, so 404-not-403 (§6) falls out
once a transport exists.

Then re-verify P7.1 as the gate actually words it: a real HTTP 404, asserted
against the response status.

### P7.2 — a genuinely severed connection

The gate says: *"Do not proceed until you have tested with the network actually
severed mid-upload."* The current test aborts a `fetch` — and does so against an
in-process service call, not a socket. An aborted fetch is a clean
client-initiated teardown; a dropped link is not. The difference is
exactly the class of bug this gate exists to find — half-written chunks, a
server holding a connection open, a resume offset computed from a request that
the server considered complete and the client did not.

Interpose a TCP proxy between client and API. Mid-upload, `socket.destroy()` on
both sides — an RST with no FIN, no graceful close, which is what a link drop
looks like at the transport layer.

Assert:

- the client observes a transport error, not an application-level abort;
- resume completes and the assembled SHA-256 matches the original;
- bytes re-sent are materially less than a full re-upload (the gate requires
  this asserted, not observed).

In-process and deterministic, so it runs in CI. A `docker network disconnect`
variant against the compose stack is documented in the runbook as a manual
drill — closer to the real thing, too slow and too environment-dependent for
every commit.

### P14.3 — security headers (application half)

The gate has two halves. Cloudflare's WAF, edge rate limiting and bot
protection need an account and stay `open`. The header set does not.

Current state: `next.config.mjs` sends four headers and **no CSP**. The API
sends none at all — no `helmet`, no header middleware, nothing in `main.ts`.

- Next: add `Content-Security-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`. The CSP must be
  built against what the app actually loads — Cornerstone3D uses web workers
  and `wasm-unsafe-eval` for its codecs, so `worker-src` and `script-src` need
  deliberate values rather than a copied-in policy that breaks the viewer.
- API: security headers on every response, including error responses.
- A test asserting the exact expected header set on both, so a header silently
  dropped during a refactor fails CI. Assert the CSP's directives, not that the
  header merely exists.

P14.3 moves `open` → `partial`, with the note naming the edge half as the
remainder. It does not become `verified`; "grade A from an external scanner"
needs a deployed origin.

### Terraform static validation

Closes no gate. `terraform fmt -check`, `terraform validate`, and `checkov` in
CI, so ~2,700 lines of infrastructure nobody can apply do not rot silently
before the account exists. Recorded as such — it is hygiene, not a gate.

---

## §4 Batch B — gates that close to `local`

### P4.1 + P4.3 — Keycloak realm and conditional MFA

`infra/keycloak/configure-mfa.sh` does not work. Reading it:

- it creates `conditional-user-role` executions but never sets their role
  config — the script's own comment states the execution id must be resolved
  from the flow listing, and then never does it;
- the conditional subflow is created with `provider=registration-page-form`,
  which is not a subflow provider;
- it never binds the flow to the browser flow, which the script's closing note
  correctly lists as a manual step.

The result is a flow that enforces nothing. The API's independent `AuthGuard`
check means this fails closed — doctors are locked out rather than let in — so
it has never been noticed.

Rewrite against the Keycloak admin REST API: create the flow, create the
conditional subflow, set each role condition's config, set requirements to
`REQUIRED`, and bind the flow. Idempotent on re-run.

Then verify behaviourally against the compose Keycloak, which is the actual
gate — all three of the script's own stated conditions:

| Check | Expected |
|---|---|
| Doctor account, no TOTP enrolled, attempts login | forced into enrolment; login cannot complete |
| Patient account attempts login | no TOTP prompt |
| Decode a doctor's access token | `amr` contains `otp` (or `acr` > 1) |

P4.1 and P4.3 → `local`. Note: "local Keycloak; deployed realm unverified."

### P15.1 — backup restore drill

The runbook is written and has never been run. Documented restore procedures
are routinely wrong in ways only execution reveals.

`pg_basebackup` + WAL archive from the compose Postgres, restore into a scratch
container, then verify what the gate actually asks — not that the restore
command exited zero, but that **studies are still linked to the right
patients**: foreign keys intact, `imaging_instances` → `imaging_studies` →
`patients_patients` chains resolve, and the `scheduling_appointment_studies`
link table is consistent.

Record the measured RTO in `docs/runbooks/dr.md`, alongside an explicit note
that this measures a local single-node restore and is **not** the RDS PITR
number P2.5 requires.

P15.1 → `local`. P2.5 stays `blocked`.

### P13 — trace collector

Spans are created, named and scrubbed, and that is tested. The exporter writes
JSON to a file; nothing ships. "Traces across API → DB → Orthanc → S3" is
unproven as a delivered pipeline.

Add an OTLP collector to compose, point the exporter at it, and assert a real
trace arrives spanning API → DB → Orthanc under one trace id — and that the
scrubber still applies on the wire, not just at the file writer. The scrubbing
test currently covers the JSON exporter's output; a second export path is a
second place for patient data to escape.

P13 currently reads `verified` with the note "no collector wired". It stays
`verified` — scrubbing was the gate — and the note loses that caveat.

---

## §5 Batch C — blocked gates made runnable

### P2.4 — the Object Lock probe

The spec calls this *"the single most important infrastructure gate — a
deletable original is a lost scan is a lawsuit."* It has never been run and
cannot be run here.

Write `scripts/verify-object-lock.mjs` as the real probe, executable against a
real account by setting credentials:

1. Upload an object to `*-dicom-originals`.
2. `DeleteObject` → assert it is **rejected**, and rejected *by Object Lock*
   rather than by a bucket policy or missing permission. A delete denied for
   the wrong reason passes a naive check while leaving the object deletable by
   anyone with the right IAM.
3. `DeleteObjectVersion` on the version id → assert rejected.
4. Anonymous `curl` of the object URL → assert 403.
5. Assert the replica exists in the DR region.

I will attempt to exercise the probe against LocalStack to prove the probe
itself runs and its assertions fire. **P2.4 stays `blocked` regardless.**
LocalStack does not implement compliance-mode retention faithfully, and a probe
passing against it says nothing about AWS. If LocalStack cannot enforce enough
for the run to be meaningful, that is recorded as a finding rather than worked
around — the deliverable is a correct probe, not a green line.

Value: when an account exists this is one `AWS_ENDPOINT_URL` away, instead of a
from-scratch task written under launch pressure.

### P15.3 — incident response tabletop

The gate asks for a tabletop of *"a suspected unauthorized access to one
patient's study"*, with gaps logged and fixed. An exercise is something that can
genuinely be performed here.

Run it against a seeded local database, and — this is the part that makes it
worth doing — **execute the forensic queries the runbook instructs a responder
to run**. A runbook that says "identify every study this actor accessed" is
worthless if the query it gives returns the wrong rows, and that is only
discoverable by running it under the scenario.

Record the walkthrough, every query that failed or returned something
unexpected, and the fixes. Output is an appendix to
`docs/runbooks/incident-response.md`.

P15.3 → `verified`. The spec asks for an exercise; the exercise was performed.

---

## §6 Verification

Every claim in this design is subject to the rule the repository already
enforces: **a gate moves only when its verification was executed and its output
observed.** Where output is observed, the evidence goes in the ledger note.
Where something cannot be run, the gate does not move and the reason is
recorded.

New commands:

| Command | Purpose |
|---|---|
| `pnpm scan:verify` | P14.2 red/green proof |
| `pnpm verify:object-lock` | P2.4 probe (needs credentials) |
| `pnpm drill:restore` | P15.1 restore drill |

CI additions: `scan:verify`, Terraform `fmt`/`validate`/`checkov`, the header
assertion test, the severed-connection test.

## §7 Projected outcome

| Status | Before | After | Movement |
|---|---|---|---|
| verified | 27 | 30 | `+P14.2` `+P7.2` `+P15.3` |
| local | — | 3 | `+P4.1` `+P4.3` `+P15.1` |
| partial | 7 | 4 | `−P14.2` `−P7.2` `−P4.1` `−P4.3` `+P14.3` |
| open | 4 | 1 | `−P14.3` `−P15.1` `−P15.3` |
| blocked | 9 | 9 | unchanged |
| **total** | **47** | **47** | |

P7.1 does not move — it is `verified` before and after — but it is `verified`
truthfully only after the transport exists and its 404 is asserted over HTTP.
The count is unchanged; the claim behind it stops being wrong.

Remaining after: `partial` = P1.3, P4.5, P8.1, P14.3. `open` = P15.2 (region
failure drill — needs a second region, so it is arguably blocked; left `open`
because it is not being worked here and reclassifying it would be a judgement
call dressed up as progress).

Nine blocked gates unchanged. L1–L8 unanswered. No pen test. No infrastructure.

**Still not launchable, and the README's headline does not change.**

What changes is that the remaining gaps are all genuinely external — an
account, a vendor, a lawyer — rather than a mix of external blockers and work
nobody had gotten to.

## §8 Risks

**A `local` status becomes a way to launder unfinished work.** Mitigation: the
definition requires an executed run with observed output, and every `local`
note must name the stand-in. If a gate cannot say what stood in for what, it is
not `local`.

**The CSP breaks the viewer.** Cornerstone3D's codec path uses workers and
WASM. Mitigation: build the policy from observed load behaviour, and the
existing viewer e2e tests run against the CSP — a policy that breaks rendering
fails CI rather than shipping.

**The restore drill's RTO gets quoted as the real one.** A single-node local
restore is much faster than managed PITR. Mitigation: `dr.md` records the
number with the stand-in named in the same sentence, and P2.5 stays `blocked`.

**`configure-mfa.sh` currently fails closed; a rewrite could fail open.** A
correct-looking flow that does not actually require OTP would be worse than
today's broken-but-safe script. Mitigation: the gate is behavioural — a doctor
without TOTP must be unable to complete login. That is asserted by execution,
not by reading the flow's configuration.
