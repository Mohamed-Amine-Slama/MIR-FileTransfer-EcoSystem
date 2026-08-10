# Pre-launch checklist

**BUILD_SPEC PHASE 16.** "Every line must be checked before the first real
patient."

---

## How to read this

- ✅ **Verified** — a test or command was run and its output observed. The
  evidence column says which.
- ⬜ **Open** — not done. No partial credit.
- 🔒 **Blocked** — cannot be done from this repository; needs credentials, a
  third party, or a legal answer.

**Nothing here is checked off on the basis of code review.** A gate is passed
when its verification was executed and the result observed.

> ### Current headline
> **The application is substantially built and tested. It is NOT launchable.**
> All eight legal prerequisites are unanswered, no infrastructure exists, and
> there has been no penetration test. Those are not paperwork — L1 decides
> whether the transfer is lawful at all.

---

## Legal

| Item | Status | Notes |
|---|---|---|
| L1–L8 resolved in writing | 🔒 **open** | **None answered.** Blocks launch outright. |
| Consent text reviewed by counsel, published ar + fr | 🔒 open | Mechanism built and tested; the *wording* is counsel's (L4) |
| Terms of service state the platform is not a diagnostic tool | ⬜ open | Viewer banner is done and tested; ToS not written |
| Retention periods configured to match L5 | 🔒 open | Config keys exist with **placeholder** values. Object Lock retention is **irreversible** — do not apply a guess |
| DPA/BAA-equivalent signed with cloud provider | 🔒 open | No account exists |

**Payment entity — RESOLVED (2026-08-10):** the business is incorporated in
**Estonia**, which Stripe supports. D2's authorise-then-capture works as built.

**Two obligations that follow from that, and are now open items:**

| Item | Status | Notes |
|---|---|---|
| DPA signed with AWS (GDPR Art 28) | 🔒 open | L3 is now unconditional, not conditional |
| **SCCs with each Tunisian doctor/clinic** | 🔒 **open** | Tunisia has no EU adequacy decision. A Tunisian doctor viewing EU-hosted data is a Chapter V restricted transfer |
| Transfer impact assessment | 🔒 open | Accompanies the SCCs |
| Breach notification assumed at 72h (GDPR Art 33) | ⚠️ | Supersedes the "unknown" in the incident runbook unless L8 finds something stricter |

**Product consequence:** a Tunisian doctor must not be verified/activated until
their SCCs are signed. `identity_doctor_profiles.verified_at` is the gate.

---

## Access control

| Item | Status | Evidence |
|---|---|---|
| All P3.2 RLS tests green in CI | ✅ | 21 tests; run in CI on every commit against real PostgreSQL |
| Cross-doctor and cross-patient isolation verified end-to-end | ✅ | `patients.e2e.test.ts` — through HTTP, 404 not 403 |
| Consent revocation immediately removes access | ✅ | `consent.test.ts` — access disappears on next query |
| MFA enforced on all clinical accounts | ⚠️ **partial** | API guard verified by test; **Keycloak flow not bound or exercised** |
| No standing production data access for engineers | 🔒 open | P14.1 — no production exists |

**MFA caveat.** `AuthGuard` independently rejects a clinical-role token showing
no second factor, and that is tested. But the Keycloak conditional-MFA flow has
not been bound or behaviourally verified — `infra/keycloak/configure-mfa.sh`
documents what a human must check. It fails closed (doctors locked out rather
than let in), but it is unverified.

---

## Data integrity

| Item | Status | Evidence |
|---|---|---|
| Object Lock verified — originals cannot be deleted | 🔒 **open** | Terraform written (compliance mode). **The delete-rejection probe has never been run.** This is the spec's single most important infra gate |
| Cross-region replication verified | 🔒 open | Configured, never applied |
| Checksums verified end-to-end on upload | ✅ | `upload.test.ts` — SHA-256 over decoded original; corrupt chunk rejected |
| PITR restore drill completed within target RTO | 🔒 open | `docs/runbooks/dr.md` — **RTO/RPO unmeasured** |
| No lossy transcoding anywhere in the pipeline | ✅ | Byte-for-byte equality asserted; Orthanc `IngestTranscoding` omitted; lossy syntaxes flagged not converted |

---

## Reliability

| Item | Status | Evidence |
|---|---|---|
| Interrupted upload resumes on a poor connection | ✅ / ⚠️ | Resume verified (killed at 40%, >35% bytes saved) and browser hard-close verified. **Not tested with a physically severed TCP connection** |
| Concurrency: exactly one booking wins a contested slot | ✅ | 50 concurrent → 1 success, 49 clean 409s; deterministic over 5 rounds |
| p95 time-to-first-image under target on throttled connection | ✅ | **~1.0s** vs 5s budget at 2 Mbit/s / 200ms, desktop and mobile |

---

## Security

| Item | Status | Evidence |
|---|---|---|
| Pen test complete, high/critical remediated | 🔒 **open** | Not commissioned. **Spec: do not onboard real patients before this** |
| Secret scanning enforced in CI | ✅ | gitleaks; proven to catch planted AWS/GitHub/Orthanc credentials |
| Dependency scanning enforced in CI | ⚠️ partial | Job added (`pnpm audit` + Trivy, fail on high/critical). **Not yet demonstrated red** with a deliberately vulnerable dependency |
| Log scrubbing verified with real sensitive payloads | ✅ | 16 tests; patient name + JWT stripped from logs and Sentry payloads. One **documented limitation** below |
| Audit log immutability verified | ✅ | UPDATE and DELETE both denied to `mir_app`; row survives both |

**Log-scrubbing limitation, stated plainly:** a patient name appearing *only*
in free text, with no accompanying field to learn it from, is **not** scrubbed.
Names have no detectable shape. The mitigation is not to interpolate patient
data into messages; the limitation is recorded as a passing test so nobody
mistakes it for coverage.

---

## Operations

| Item | Status | Evidence |
|---|---|---|
| Alerts fire and reach a human on call | ⬜ open | Detection logic written and tested; **no on-call rotation exists** |
| Incident response runbook exercised | ⬜ open | Written (`docs/runbooks/incident-response.md`); **tabletop not run** |
| Staging contains zero real patient records — verified by query | 🔒 open | No staging exists. ADR-7 enforced in CI for `test-data/` |

---

## Claims

| Item | Status |
|---|---|
| Marketing describes security accurately | ⬜ open — no marketing material yet |

When it is written: **do not use "military grade".** It is not a technical
standard and overclaiming becomes a liability during a breach investigation.
Describe the architecture — AES-256 at rest, TLS 1.3 in transit, row-level
access control, immutable audit log — and only claim what the Verified column
above supports.

---

## Phase completion

| Phase | Status |
|---|---|
| P0 Foundations | ✅ |
| P1 Guardrails | ✅ (P1.3 red/green proven locally; never on a real PR) |
| P2 Infrastructure | 🔒 written, **zero gates run** |
| P3 Schema + RLS | ✅ |
| P4 Identity, audit | ✅ except Keycloak deployment |
| P5 Patients, consent | ✅ |
| P6 DICOM validation | ✅ |
| P7 Resumable upload | ✅ except physically-severed-network test |
| P8 Orthanc + DICOMweb | ✅ locally; VPC isolation unverified |
| P9 Viewer | ✅ gates met; **Cornerstone3D not installed** — thumbnails only, no full-fidelity rendering |
| P10 Scheduling | ✅ |
| P11 Payments | ✅ code; **rail viability unresolved (L7/D2a)** |
| P12 Notifications | ✅ templates + guard; no delivery provider wired |
| P13 Observability | ✅ scrubbing + tracing; no collector wired |
| P14 Hardening | ⚠️ threat model + dep scanning written; **no pen test**, no edge config |
| P15 Resilience | ⬜ runbooks written, **no drills run** |
| P16 This checklist | ✅ |

---

## The five things to do first

1. **Get L1 answered.** If the transfer is not lawful, nothing else matters.
2. **Run the P2.4 Object Lock probe.** It is the one gate the spec singles out,
   and it cannot be inferred from reading Terraform.
3. **Commission the penetration test**, focused on authorization boundaries
   between doctors and between patients.
4. **Resolve the Stripe entity question (D2a/L7)** before building any more on
   that assumption.
5. **Run the tabletop and one restore drill.** Both are cheap and both
   routinely reveal that a documented procedure does not work.
