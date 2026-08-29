# Frontend brief audit (§7)

Status: **complete** — 2026-08-29
Scope: `frontend-technical-brief.md`, every P0 and P1 row.

§7 of the brief asks the team to mark each row **Confirmed shipped**,
**Partially shipped**, or **Not yet shipped** *before* estimating, "so remaining
effort is scoped against reality rather than assumption". This is that audit.

---

## The one thing to read first

Every screen in §5.1–§5.8 is built and every P0 and P1 row below is
**Confirmed shipped at the UI layer**. But the case layer — cases, providers,
ledger, messaging, notifications, file-access trail — is served by
`apps/web/lib/api/mock/`, **not by an API**. There are no backend endpoints for
any of it yet.

That is a deliberate seam, not an oversight: `CasesApi` in
`apps/web/lib/api/cases.ts` is one interface with one fixture implementation
behind it, so wiring the real client is a change to
`apps/web/lib/api/mock/index.ts` and nothing else. But it means **"shipped"
below always means "the interface is built, typed, tested, and correct against
the contract"** — never "a clinic can use this against real data today".

`isMockMode()` defaults to **live**, so a missing or misspelled environment
variable can never silently serve fixtures to a clinic. Today that means the
case screens have nothing to talk to until the endpoints exist. That is the
correct failure direction: invented patients on a real screen is the worse bug.

The V0 modules — patients, upload, viewer, appointments, consent, audit — are
genuinely end-to-end against the NestJS API and Postgres.

---

## §5.1 Authentication & Onboarding

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Separate sign-up/verification flow for providers vs. internal admin | P0 | **Confirmed shipped** | `/signup/provider`. Admin is excluded *structurally*: `Provider.side` is `EndpointSide`, which has no `ops` member, so no submission of this form can create platform staff. The screen says so rather than leaving an admin hunting. |
| Verification collects credentials, data-driven per corridor | P0 | **Confirmed shipped** | Fields come from `corridor[side].documentRequirements`. Changing side re-renders the form and clears the credentials, so one corridor's licence number cannot be submitted against another's rules. |
| Pending/approved/rejected visible without contacting the team | P0 | **Confirmed shipped** | `/verification` states the decision, the date, and — when refused — the reason. `providerVerificationSchema` refuses a decided verification with no `decidedAt`, so "rejected, blank date" is unrepresentable. |
| Password reset / account recovery | P0 | **Partially shipped** | `/reset-password` is built and answers identically whether or not the address is registered (it must not become an oracle for which clinicians have accounts). The actual send is Keycloak's (ADR-2) and is **not yet wired** — the screen does not claim we emailed anyone. |
| Multi-language onboarding (ar/fr minimum) | P0 | **Confirmed shipped** | Both, plus English. See §4.2. |
| Admin-side provider approval queue | P0 | **Confirmed shipped** | `/admin/providers`. Rejections carry a dictionary key from a fixed list, never free text — an ops reviewer's English sentence would be unreadable to an Arabic-speaking applicant. |

## §5.2 Case Submission

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Structured intake form | P0 | **Confirmed shipped** | `/cases/new`, rendered from `corridor.intakeFields`. |
| Attachment of files and imaging as part of submission | P0 | **Partially shipped** | Upload is reachable from the case and carries the reference (`/upload?case=…`), and the case detail lists its studies. The queue still keys on `patientId`; **binding the upload session to the case ref is backend work not yet done**. |
| Client-side validation on required fields and file types/sizes | P0 | **Confirmed shipped** | `validateFields` for the form; `validateMedicalFile` runs *before* an upload session is created, so a clinic on a slow link learns in a second. Extensionless files pass deliberately — that is the commonest shape of a real DICOM export — and content is checked server-side. |
| Confirmation screen showing a case reference number | P0 | **Confirmed shipped** | `formatCaseRef` is the only way to make one; it throws outside 1–9999 rather than emitting a malformed ref. |
| Draft-saving | P1 | **Confirmed shipped** | Local, and narrow on purpose: the draft holds the structured answers and a patient id, never a file (§4.4). |
| Corridor-aware field variation | P1 | **Confirmed shipped** | See §4.3. |
| Bulk/multi-case submission | P2 | **Not yet shipped** | Deferred as P2. |

## §5.3 Matching & Case Pipeline

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Visible pipeline for both matched sides | P0 | **Confirmed shipped** | `/cases`, `/cases/[ref]`. |
| Consistent status labels across provider and admin views | P0 | **Confirmed shipped** | One `TRANSITIONS` table in the contract, read by both. Labels are exhaustive `Record`s, so a new status is a compile error rather than a raw `under_review` shown to a receptionist. |
| Status change history / timeline per case | P1 | **Confirmed shipped** | `CaseTimeline`, gated on the case itself. |
| Filtering/search by status, date, reference | P1 | **Confirmed shipped** | All three. Date bounds compare the date part, so "up to the 6th" includes a case updated at 11:30 on the 6th. |
| Indication of what action is expected next | P1 | **Confirmed shipped** | Keyed by status **and** side, so the two clinics are told different and correct things about one case. |

## §5.4 Secure File & Imaging Transfer

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Upload/download UI tied to a specific case | P0 | **Partially shipped** | Upload, resume, and the DICOM viewer are V0 and real. The case link is built; see §5.2 for the remaining backend binding. |
| Encryption in transit; no path that bypasses it | P0 | **Confirmed shipped** | No unauthenticated file link exists in the UI; the viewer route is authenticated. |
| RBAC reflected in UI — only a case's parties see its files | P0 | **Confirmed shipped** | Case reads take a `CaseAudience`. `getCase` returns null both for "no such case" and "not yours", so a guessed reference cannot be confirmed; the timeline and message thread are gated on the case, not just the case row. |
| Visible audit trail per file | P1 | **Confirmed shipped** | "Last accessed by X · side · action · date" beside each study; a study nobody has opened says so rather than rendering blank. |
| Large-file progress and resumability | P1 | **Confirmed shipped** | V0, IndexedDB-backed. Stores the browser's `File` **handle**, never the content — which is how it satisfies both this row and §4.4. |
| In-browser preview | P2 | **Confirmed shipped** | Cornerstone viewer, ahead of its P2 priority. |

## §5.5 Practice / Case Management

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Day-to-day workspace | P0 | **Confirmed shipped** | `/workspace`. |
| Calendar/scheduling view tied to cases | P1 | **Partially shipped** | Appointments are a real V0 module and a case links to its appointment. There is **no calendar filtered by case** — the case links into scheduling rather than scheduling growing a case dimension. |
| Task/reminder surface across a caseload | P1 | **Confirmed shipped** | Tasks are derived from `isAwaitingSide`, which reads the same next-action table the case list renders — so a case cannot be a task on one screen and "nothing to do" on another. Decided on an enum, never on translated copy. |
| Team/multi-seat access within one clinic account | P1 | **Partially shipped** | The model is right — a provider is an organisation, seats are counted, users reference a provider. **Seat management (inviting and removing users) is not built**, and the identity backend has no organisation claim yet: `current-provider.ts` maps role→provider through the corridor side as a documented stand-in. |

## §5.6 Messaging & Notifications

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Case-level notifications | P0 | **Confirmed shipped** | Exactly the three triggers the brief names. |
| Direct messaging between matched providers, scoped to a case | P0 | **Confirmed shipped** | `caseRef` is required by the schema, so a message belonging to no case is unrepresentable. |
| In-app notification centre | P1 | **Confirmed shipped** | `/notifications`. Unread is carried by weight and a logical border, not colour alone. |
| Read/unread and delivery indicators | P1 | **Confirmed shipped** | The schema refuses a `readAt` earlier than its `deliveredAt`. |
| Notification preferences | P2 | **Not yet shipped** | Deferred as P2. |

## §5.7 Billing, Ledger & Settlement

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Auditable ledger per provider account | P0 | **Confirmed shipped** | `/ledger`. |
| Coordination fees never merged with subscription charges | P0 | **Confirmed shipped** | A discriminated union with **no common total**, two tables, two exports with different columns, and a `LedgerSummary` with no `total`/`balance`/`amountOwed` field. The ambiguous line cannot be built by accident because there is no field to render. |
| Per-case fee breakdown linked to the case reference | P1 | **Confirmed shipped** | `caseRef` is required on a coordination fee and forbidden on a subscription — Zod strips it, so a careless caller cannot blur them. |
| Downloadable/exportable statements | P1 | **Confirmed shipped** | CSV, RFC 4180, UTF-8 BOM for Excel, formula-injection guarded, no total row. PDF not built. |
| Multi-currency display | P1 | **Confirmed shipped** | Totals group by currency and are never summed across them. `CURRENCY_MINOR_UNITS` is a total `Record`: **TND and LYD have an ISO exponent of 3**, and the usual `/100` overstated every dinar figure tenfold — on this corridor's own local currencies. |
| Payment status indicators | P1 | **Confirmed shipped** | paid / pending / overdue, with an outstanding **count** rather than a summed amount. |

## §5.8 Admin / Ops Dashboard

| Requirement | P | Verdict | Notes |
|---|---|---|---|
| Case pipeline across all providers | P0 | **Confirmed shipped** | `/admin/cases`. |
| Provider directory including the approval queue | P0 | **Confirmed shipped** | `/admin/providers`. The queue sits above the directory rather than being a filter on it — the queue is work, the directory is reference. |
| Ledger oversight across all accounts | P0 | **Confirmed shipped** | `/admin/ledger`, with the two kinds in separate columns. A single sortable "balance" column is what a finance tool would do and what §5.7 P0 forbids. |
| Search/filter across cases and providers | P1 | **Confirmed shipped** | Reference search on cases, legal-name search on providers — ops has a name from a phone call, not an id. |
| Manual case status override | P1 | **Confirmed shipped** | Bounded to `nextStatuses(current)`. Ops **cannot** reopen a completed case, because that would silently invalidate the coordination fee completion raised. A case with nowhere legal to go says so instead of offering a dead control. |
| Basic operational reporting | P2 | **Not yet shipped** | Deferred as P2. |

---

## Cross-cutting (§4)

- **§4.1 credibility over cleverness** — explicit labels, no icon-only actions, no
  playful microcopy on status, files, or money. Every case screen states what is
  expected of the viewer next.
- **§4.2 i18n** — `LOCALES` (ar, fr) is content and DB-constrained;
  `UI_LOCALES` adds English for admin as *presentation only*, so English never
  reaches a `CHECK (locale IN ('ar','fr'))` column. `Dictionary` is derived from
  the Arabic table and the other tables are declared as the same type, so a
  missing translation is a build error. RTL is layout-level: `DirectionProvider`,
  logical properties only (lint-enforced), `<bdi>` around Latin references and
  names inside Arabic text.
- **§4.3 corridor configurability** — `lib/corridor/registry.ts` is the only file
  that names a country, and a **ratcheting test** enforces it. Thirteen V0 screens
  are on a documented allowlist that may only shrink. Access gating uses
  `rolesForSides(...)`, never role literals.
- **§4.4 security** — role-gated UI over an API guard and RLS (the gate is
  usability, not the control); no medical file content in browser storage;
  case-scoped file access; the per-file audit trail; and a **visible** idle
  timeout with a countdown and an extend button instead of a silent 401.
- **§4.5 responsive** — mobile drawer nav, tables that scroll inside their own
  container rather than the page, and a Playwright project pinned to a Pixel 7 so
  every e2e assertion is also a mobile assertion.

## What to build next

1. **The case-layer API.** Nine screens are waiting on it. The interface they
   were written against is the specification for it.
2. **Keycloak reset wiring**, so `/reset-password` does what it says.
3. **An organisation claim on the session**, retiring the role→provider
   stand-in in `current-provider.ts`.
4. **Binding upload sessions to a case ref**, closing the last part of §5.2.
5. **Seat management**, closing §5.5's multi-seat row.
