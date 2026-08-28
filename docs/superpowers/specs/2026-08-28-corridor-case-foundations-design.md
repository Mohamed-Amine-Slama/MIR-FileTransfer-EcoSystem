# Corridor & Case Foundations — Design

**Date:** 2026-08-28
**Status:** Approved
**Source brief:** `frontend-technical-brief.md`
**Scope of this spec:** the foundation slice only (§4.2 English admin locale, §4.3 corridor
configurability, and the contracts that unblock §5.1, §5.2, §5.3, §5.8). Module UI is
built on top of this in later slices, each with its own spec.

---

## 1. Why this slice exists

The brief asks for eight modules. An audit of V0 against §5 found 28 of 40 rows are
net-new, and they hang off domain objects the codebase does not have: there is no
`Case`, no `Provider` organization, and no `Corridor` anywhere.

V0's spine is `patient → study → appointment`. The brief's spine is
`provider → case → corridor`. Building any module first would mean building it against
the wrong spine and retrofitting later. This slice installs the spine.

### V0 audit (brief §7 deliverable)

| Module | Shipped | Partial | Not shipped |
|---|---|---|---|
| 5.1 Auth & onboarding | 1/6 | — | 5/6 |
| 5.2 Case submission | 1/7 | 3/7 | 3/7 |
| 5.3 Pipeline & status | 0/5 | 2/5 | 3/5 |
| 5.4 File & imaging transfer | 3/6 | 2/6 | 1/6 |
| 5.5 Practice management | 1/4 | 1/4 | 2/4 |
| 5.6 Messaging & notifications | 0/5 | — | 5/5 |
| 5.7 Billing & ledger | 0/6 | 1/6 | 5/6 |
| 5.8 Admin / ops | 0/6 | — | 6/6 |

What V0 has and this slice must not break: the typed ar/fr dictionary with RTL driven off
`LOCALE_DIRECTION`, resumable upload via the IndexedDB queue, the Cornerstone viewer,
`RoleGate` + role-filtered nav, and the responsive shell.

---

## 2. Constraints discovered

Two facts in the codebase constrain the design. Both were verified, not assumed.

**C1. The role enum cannot be renamed.** `libya_doctor` / `tunisia_doctor` appear 299
times across `apps/api/migrations/*.sql` (including RLS policies), the Keycloak realm at
`infra/keycloak/realm-mir.json`, API controllers, and web pages.
`packages/contracts/src/roles.ts:6` states the awkwardness is deliberate: "Adding a role
means changing this, the realm, and a migration — deliberately awkward, because a new
role is a new access path." A rename is a backend migration, and the brief is
frontend-scoped.

**C2. `LOCALES` is coupled to database CHECK constraints.**
`apps/api/migrations/0001_init.up.sql:54` and `0003_consent_terms.up.sql:21` both declare
`CHECK (locale IN ('ar','fr'))`. Adding `'en'` to the shared `LOCALES` enum would let the
type system accept a value Postgres rejects at write time.

---

## 3. Design

### A. Corridor layer — §4.3 without touching 299 call sites

§4.3 requires that no UI copy, routing, or business logic assume Libya/Tunisia as
constants. The approach is not to rename the roles but to **demote them to data**: a
corridor declares which role plays which side, and the UI reasons only in sides.

```
Corridor
  id: CorridorId                       // 'ly-tn'
  source:      { country, role, licensingBody, documentRequirements }
  destination: { country, role, licensingBody, documentRequirements }
  intakeFields: FieldSpec[]            // data-driven per §4.3
  currencies:   CurrencyCode[]

type CaseSide = 'source' | 'destination' | 'ops'
resolveSide(corridor, role): CaseSide | null
```

`libya_doctor` remains the stored role and the RLS subject; it stops being a constant in
presentation logic. Adding a Morocco→France corridor is a new config object, not a code
change. Corridor-specific compliance copy, intake fields, and licensing bodies are all
resolved from the corridor record.

**Invariant:** no file under `apps/web/app/` or `apps/web/components/` may reference a
country name or a `*_doctor` role literal. Enforced by a test that greps the tree.

### B. Case contracts

- `CaseRef` — `MIR-YYYY-NNNN`, the reference number §5.2 requires on the confirmation screen.
- `CaseStatus` — `submitted → under_review → matched → in_progress → completed`, plus
  terminal `rejected` and `cancelled`. Transitions are a table, not scattered conditionals,
  so provider and admin views cannot disagree about what a status means (§5.3).
- `Case` — owns `patientId`, `studyIds`, `appointmentId`, so V0's imaging and scheduling
  work becomes what happens *inside* a case rather than being replaced.
- `CaseEvent` — the §5.3 status-change timeline and the §4.4 "surfaced back to the user"
  audit requirement.
- `Provider` + `ProviderVerification` — `pending | approved | rejected`, the state §5.1
  requires be visible without contacting the platform team.
- `Message`, `Notification` — §5.6.
- `LedgerEntry` — a **discriminated union** of `coordination_fee | saas_subscription`.

The ledger union is load-bearing. §5.7 says the two charge kinds must never be visually
merged into one ambiguous "amount owed" line. Modelling them as a union means there is no
single `amountOwed` field to render — the requirement is enforced by the type system
rather than by reviewer vigilance.

All contracts are Zod schemas, so the mock layer and the eventual real API validate
identically.

### C. API layer

`apps/web/lib/api/mock/` holds fixtures behind the existing typed surface in
`lib/api/endpoints.ts`. `NEXT_PUBLIC_MIR_API_MODE` (`mock` | `live`, defaulting to `live`
so a missing variable can never silently serve fixtures in production) selects which. The backend team later
implements to a contract that is already pinned and already exercised by tests.

### D. i18n — split UI locale from content locale

Per C2:

```
LOCALES    = ['ar','fr']        // unchanged. DB-backed: user rows, consent terms.
UI_LOCALES = ['ar','fr','en']   // new. Presentation only, never persisted.
```

`en` serves admin/internal per §4.2. The dictionary keeps compiler-enforced completeness:
`en` is declared as the same type derived from `ar`, so a missing key is a build error.

Direction: `LOCALE_DIRECTION` is typed `Record<Locale, …>` and is read by the API and the
Keycloak realm, so it is left untouched. A new `UI_LOCALE_DIRECTION: Record<UiLocale, …>`
covers all three and is what `LocaleProvider` and `AppShell` read. A test asserts it is a
superset of `LOCALE_DIRECTION`, so the two can never disagree about `ar` or `fr`.

**Invariant:** a UI locale is never written to a field typed as a content locale. The
types are distinct and do not overlap structurally.

### E. Testing

TDD, following the repo's existing pattern:

- `packages/contracts` — corridor side resolution, status transition legality, ledger
  discrimination, ref formatting/parsing, locale separation.
- `apps/web` — vitest for the corridor field registry and dictionary completeness.
- The country/role literal invariant from §A as an executable test.
- `pnpm verify` is the gate (typecheck, lint, boundaries, test, build, bundle secrets).

---

## 4. Out of scope for this slice

Module UI (§5.1–5.8 screens), backend modules for cases/providers/corridors/messaging/
ledger, database migrations, and any change to the existing role enum or the Keycloak
realm. Each module gets its own spec built on these foundations.

---

## 5. Sequencing

1. Corridor contracts + tests
2. Case / provider / ledger / messaging contracts + tests
3. UI locale split + `en` dictionary
4. Corridor-driven field registry
5. Mock API layer + fixtures
6. Country-literal invariant test; `pnpm verify` green
