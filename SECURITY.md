# Security policy

## Reporting a vulnerability

Report privately through GitHub's **[private vulnerability
reporting](https://github.com/Mohamed-Amine-Slama/MIR-FileTransfer-EcoSystem/security/advisories/new)**
on this repository. Do not open a public issue for a suspected vulnerability in
access control, authentication, or data handling.

Include what you did, what happened, what you expected, and — if it touches
authorization — which two accounts or roles were involved. Cross-account
findings are the ones we most want: this platform's central security property
is that one doctor cannot reach another doctor's patients.

Expect an acknowledgement within three working days.

There is no bug bounty. This is a pre-launch project.

## Scope

This repository holds the application, its infrastructure-as-code, and
**synthetic DICOM fixtures only** (ADR-7). No real patient data exists in any
environment, and none may be copied into one — including into staging or CI,
including once, including for debugging.

In scope: authorization boundaries between doctors and between patients,
consent enforcement, audit-log integrity, upload integrity, and anything that
would let the browser reach Orthanc or object storage without passing the API.

Out of scope: findings that require an account role to be deliberately
misassigned by an administrator, and the unresolved items listed below, which
are known and tracked rather than undiscovered.

## Status — read this before relying on anything here

**This application has not been penetration tested** (BUILD_SPEC P14.4), and no
infrastructure has been provisioned. It is not deployed, has no users, and must
not be used with real patient data.

All eight legal prerequisites (L1–L8) are unanswered. L1 decides whether the
cross-border transfer is lawful at all.

Run `pnpm verify:gates` for the current accounting of what has been verified by
an executed check and what has not. That output is authoritative; this file is
a summary and can drift.

## What is actually verified

Authorization is enforced at two independent layers — application RBAC and
PostgreSQL row-level security, with the application connecting as a
non-superuser role with `NOBYPASSRLS` and no admin bypass connection (ADR-6).
The audit log is append-only at the code, `GRANT`, and object-lock levels.
Original DICOM bytes are stored unmodified and never re-encoded (ADR-4, ADR-5).
Logs are scrubbed of patient identifiers and tokens, with one documented
limitation.

Each of those is covered by tests that run in CI on every commit. Prefer
`pnpm verify:gates` over trusting this paragraph.

## Supported versions

Pre-release, version `0.1.0`. Only `main` receives fixes. There are no
released versions and no backport policy.
