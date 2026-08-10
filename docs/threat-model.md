# Threat model

**BUILD_SPEC P14.4.** Covers the seven scenarios the spec names, plus three
this system's shape makes unavoidable.

Status: **draft by the implementing engineer.** It has not been reviewed by a
third party, and it does not substitute for the penetration test P14.4
requires before real patient volume.

---

## What we are protecting, and from what

The asset is **a patient's medical imaging plus the fact that they sought care
across a border**. The second half matters as much as the first: in a small
community, "this person had a scan sent to a Tunisian oncologist" is itself
sensitive, independent of what the scan shows.

Three properties, in priority order:

1. **Confidentiality.** Only the referring doctor, the patient, and a Tunisian
   doctor named in a valid consent may see a study.
2. **Integrity.** A study is exactly the bytes the scanner produced, or it is
   rejected. A partial study must never look complete.
3. **Availability.** A doctor who cannot upload does not refer, and the patient
   does not get seen. Losing an original is unrecoverable.

Ranked bluntly: **a lost original is worse than a leaked one.** A leak is a
serious harm to one person. A lost scan may mean a repeat scan the patient
cannot afford or travel for, or a diagnosis that arrives too late.

---

## 1. Compromised doctor account

**How.** Phished credentials, a shared clinic workstation, a reused password,
a stolen phone with an active session.

**What they get.** Everything that doctor legitimately has — for a Libyan
doctor, every patient they created and every study they uploaded.

**Controls.**
- MFA is mandatory for all clinical roles, enforced *twice*: in the Keycloak
  flow, and independently in `AuthGuard`, which rejects any clinical-role token
  showing no second factor. A realm misconfiguration locks doctors out rather
  than letting them in.
- Row-level security bounds the blast radius to that doctor's own patients. A
  compromised Libyan doctor cannot enumerate the platform.
- Every access — **including refused ones** — writes a `StudyAccessed` audit
  row. The reconnaissance phase of a compromise is visible.
- Anomaly sweep flags one actor touching ≥40 distinct patients in an hour.
- Access tokens live 5 minutes; refresh tokens are single-use.

**Residual.** A doctor's own patients are still exposed for the session's
lifetime. Nothing here detects a *slow* attacker staying under the threshold.
Accepted: tightening the threshold produces noise, and a muted alert is worse
than a loose one.

---

## 2. Malicious insider (platform staff)

**How.** An engineer or support agent decides to look at a specific person's
imaging — a public figure, a relative, an ex-partner. This is the most common
real-world breach in health systems and it is rarely technical.

**Controls.**
- **Admins cannot read imaging at all.** There is no admin policy on
  `imaging_studies`; the P3.2 suite asserts an admin sees zero studies. Admins
  get identity and appointments — the things support actually needs.
- No standing production data access for engineers (P14.1). Break-glass is
  time-boxed, needs a second approver, and alerts the team.
- The application role is non-superuser, `NOBYPASSRLS`, and does not own its
  tables. SQL injection cannot escalate past the policies.
- Audit log is append-only at the GRANT level: `mir_app` holds SELECT and
  INSERT and nothing else. Archived to a compliance-mode Object Lock bucket, so
  even a full database compromise cannot rewrite history.

**Residual — the honest one.** A **superuser bypasses RLS entirely**, and
someone must hold that credential to run migrations. The defence is not
technical: it is that break-glass use is logged, alerted, and reviewed. An
insider with the migrator credential and the willingness to use it can read
anything. Detection, not prevention.

---

## 3. Stolen device with an active session

**How.** A clinic laptop or a doctor's phone is taken, unlocked, session live.

**Controls.**
- 5-minute access tokens; 30-minute idle session timeout.
- Signed image URLs expire in 5–15 minutes **and are bound to the subject**, so
  copying one out is useless to another account.
- Consent revocation takes effect on the next request — the RLS policy tests
  `revoked_at IS NULL` on every read. No cache to invalidate.

**Residual.** Within the idle window the thief has the doctor's access. Remote
session revocation exists in Keycloak but depends on someone noticing.

---

## 4. S3 misconfiguration

**How.** The classic: a bucket policy loosened during debugging, or a new
bucket created without the guardrails.

**Controls.**
- Public access blocked at the bucket level, all four flags.
- Bucket policy explicitly denies non-TLS requests and unencrypted uploads.
- SSE-KMS with a customer-managed key: a leaked bucket listing is not a leaked
  scan without KMS permissions too.
- The browser never receives object URLs directly; everything is proxied
  through the API, which authorises and audits (P8.2).
- CI greps the built frontend bundle for server-only secrets and fails the
  build (`scripts/check-bundle-secrets.mjs`), proven against a planted leak.

**Residual.** Object Lock protects against *deletion*, not against *over-broad
reads*. A sufficiently wrong bucket policy still discloses. Mitigation is
Terraform-only changes plus review; there is no console-clicking path (P2.1).

---

## 5. Dependency compromise

**How.** A malicious release of a transitive npm package, or a typosquat.

**Controls.**
- Lockfile committed; CI installs with `--frozen-lockfile`.
- Dependabot plus a CI vulnerability scan that fails on high/critical (P14.2).
- Container images scanned as well as packages.
- The application role's database privileges bound what injected code can do —
  no DDL, no DELETE, no BYPASSRLS.

**Residual — significant.** A malicious package running inside the API process
inherits the application's credentials and its RLS context, and can read
whatever the current user can. Nothing in this design stops that. The realistic
mitigations are minimising dependency count, pinning, and detection.

---

## 6. Consent bypass

**How.** A bug lets a Tunisian doctor see a study without valid consent naming
them — or consent is revoked and access lingers.

**Controls.**
- Consent is checked in the **RLS policy**, not only in application code. A
  bug in the API layer does not disclose, because the row is not returned.
- Consent names a specific doctor. Consent to doctor A grants nothing to
  doctor B — asserted by test.
- Revocation is an UPDATE, never a DELETE, and takes effect on the next query.
- Payment/triage gating (D3) is enforced at the RLS layer too, so a bug in
  scheduling cannot expose unpaid studies.
- Evidence is reconstructible: given a consent row, the exact rendered text can
  be reproduced, and `consent_terms` is immutable once published (enforced by a
  database trigger).

**Residual.** Consent is only as meaningful as the patient's understanding of
it — a legal and UX question (**L4, unanswered**), not a technical one.

---

## 7. Patient misidentification

**How.** Two people merged into one record, or a study filed against the wrong
patient. **The worst failure this system can produce**, and the hardest to
detect: nothing errors, and the harm surfaces when a doctor reads the wrong
person's scan.

**Controls.**
- Lookup is by phone **only**. No fuzzy name matching, ever — Arabic/French
  transliteration across this border is not stable enough (§17).
- A phone match returns `confirmation_required` with name and DOB, never a
  silent merge. The doctor must explicitly confirm.
- Transliteration variants are stored as typed, not normalised away.
- Merging is an admin action with an audit trail, and reversible.
- Storage keys are built from the **patient record id**, never from
  `PatientID` inside the file — file tags are metadata and are frequently
  wrong.
- Calendar dates are read back as stored strings, after a bug where `pg`
  shifted every DOB one day earlier on servers east of UTC. DOB is one of the
  two fields the doctor confirms identity with.

**Residual.** Two family members sharing one handset is common and legitimate;
the doctor's confirmation is the only thing distinguishing them. Training, not
technology.

---

## 8. Upload integrity (not in the spec's list; added)

**How.** A corrupted transfer over a poor link produces a file that parses but
is wrong; or a partial study is marked ready and read as complete.

**Controls.**
- Client SHA-256 recomputed server-side over the **decoded original**; mismatch
  is rejected and reset for retry, never "repaired".
- Server-side DICOM re-validation — client validation is never trusted.
- A study reaches `ready` only when every expected file is ingested. §17: "a
  doctor reads an incomplete study and misses a finding."
- StudyInstanceUID mismatches are flagged for review, never silently split.
- Originals are written before the database row: an orphan object is
  recoverable, a row pointing at nothing is a scan that isn't there.

---

## 9. Webhook forgery (added)

**How.** An attacker posts a forged `payment_intent.succeeded` to confirm an
appointment without paying, or replays a captured one.

**Controls.**
- HMAC signature verified against the **raw body** before anything else.
- Timestamp tolerance of 5 minutes, bounded in both directions.
- Event ids recorded; duplicates short-circuit before any state change.
- A late success never resurrects a cancelled appointment.

---

## 10. Cross-border legal exposure (added, non-technical)

The largest unmitigated risks in this system are **not technical**. L1–L8 are
unresolved: lawful basis for the transfer, INPDP registration, consent form
requirements, retention periods, telemedicine classification, payment rails,
breach notification deadlines.

A technically flawless implementation of an unlawful transfer is still an
unlawful transfer. **Do not onboard real patients before L1–L8 are answered in
writing.**

---

## Explicitly out of scope

- **Nation-state adversaries.** Not a realistic defence posture for a small
  team.
- **Physical security of clinics.** A CD left on a desk is outside this system.
- **The receiving doctor's own equipment.** Once they download for a
  diagnostic read on validated hardware, it is their governance.
- **Denial of service beyond edge rate limiting.** Cloudflare absorbs volumetric
  attacks; targeted application-layer DoS is accepted risk at this scale.

---

## Review triggers

Revisit this document when any of these change:
- a new role, or a change to what an existing role may read;
- a new path to imaging data (v2 PACS integration is exactly this);
- the payment rail or its jurisdiction;
- any L1–L8 answer;
- after the P14.4 penetration test.
