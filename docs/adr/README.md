# Architecture decision records

The seven ADRs in `BUILD_SPEC.md` §3 are settled and are not restated here.
This file records **where each one is actually enforced**, so a future change
that would break one is visible before it merges.

An ADR that lives only in prose gets eroded. Each of these has a mechanism.

| ADR | Decision | Enforced by |
|---|---|---|
| **ADR-1** | Modular monolith, not microservices | `.dependency-cruiser.cjs` + `pnpm boundaries:verify`, which plants violations and fails if the rules stop catching them |
| **ADR-2** | DICOM only in v1 | `packages/dicom-utils` magic-byte check; server-side re-validation in `IngestionService` |
| **ADR-3** | Orthanc as the DICOM server | `OrthancHttpClient` is the only caller; not exported from the imaging module's public API |
| **ADR-4** | Original bytes immutable | `putOriginal` uses `wx` (write-once); Object Lock compliance mode in Terraform; byte-equality test |
| **ADR-5** | Container-level compression only | gzip is decoded before verification and never stored; Orthanc `IngestTranscoding` deliberately omitted; lossy syntaxes flagged, never converted |
| **ADR-6** | Defence in depth on access control | PostgreSQL RLS + application RBAC; `mir_app` is non-superuser, non-owner, `NOBYPASSRLS`; 21 tests |
| **ADR-7** | Real patient data never leaves production | `test-data/check-synthetic.mjs` in CI, allowlist not denylist; fixtures generated, never downloaded |

## Decisions made during implementation

These were not in the spec. They are recorded because each one is a place
where a reasonable person might have chosen differently.

### Migrations are hand-written SQL, not ORM-generated

The spec allows Prisma or Drizzle. Neither can express `NOBYPASSRLS`, `FORCE
ROW LEVEL SECURITY`, a policy body, or a gist exclusion constraint — and a
regenerated migration would silently drop them. The security model has to be
reviewable as plain SQL in version control.

### RLS helpers are `SECURITY DEFINER`

Written naively, the policies recurse: patient visibility depends on an
appointment, appointment visibility depends on the patient, and PostgreSQL
aborts. The helpers run as their owner so their internal reads bypass RLS and
break the cycle. To stop that becoming an exfiltration primitive, every helper
returns a boolean, takes no caller identity as a parameter (it reads
`app_current_user_id()`), and pins its `search_path`.

### `current_setting(..., true)`, not the spec's form

`BUILD_SPEC` P3.2's example omits the second argument, which makes the function
*throw* whenever the setting is absent — breaking migrations, health checks and
background jobs. The NULL-safe form denies instead, which is both correct and
quieter.

### Audit immutability rests on GRANTs, not `REVOKE ... FROM PUBLIC`

The spec's `REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC` does not
restrict the table **owner**. The property holds because `mir_app` is a
non-owner holding only SELECT and INSERT.

### Calendar dates are returned as strings

`pg` parses a `DATE` into a JS `Date` at local midnight; `toISOString()` then
shifts it to UTC and, east of Greenwich, back a day. Date of birth is one of
the two fields a doctor confirms patient identity with, so a DOB that depends
on server timezone undermines P3.3 directly.

### Notifications cannot express clinical data

Rather than reviewing templates for leaks, `TemplateVariables` simply has no
clinical fields — a template cannot name one, and passing one at render time
throws. The guarantee is structural rather than editorial.

### Log scrubbing learns values from the payload

Key-based redaction cannot see a name interpolated into an error message, and
pattern-based redaction cannot recognise a name at all. Strings found under a
sensitive key are therefore stripped from every other string in the same
payload. The residual limitation — a bare name in prose with no accompanying
field — is recorded as a passing test rather than left implicit.

### Test databases are namespaced by process id

Parallel workers each truncate in `beforeEach`. Sharing a database means one
suite wipes another's fixtures mid-test, and the failures look exactly like
authorization bugs. Worker id alone is not enough: `pnpm -r test` starts a
separate process per package, each numbering workers from 1.
