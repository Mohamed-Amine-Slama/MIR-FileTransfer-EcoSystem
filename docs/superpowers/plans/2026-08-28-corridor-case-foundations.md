# Corridor & Case Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the `provider → case → corridor` spine the frontend brief requires, as typed contracts plus a mock API layer, without renaming the existing role enum or breaking the `ar|fr` database CHECK constraints.

**Architecture:** Corridor records declare which existing role plays which side of a referral, so UI code branches on `CaseSide` (`source | destination | ops`) instead of on country names — satisfying brief §4.3 while `libya_doctor` survives untouched in RLS policies and the Keycloak realm. Case, provider, ledger, and messaging contracts land in `@mir/contracts` as Zod schemas; the web app consumes them through a fixture-backed mock layer that the real API can later replace wholesale.

**Tech Stack:** TypeScript 5.7 (strict, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`), Zod 3.24, Vitest 3.2, Next.js 15 App Router, React 19, pnpm 9 workspaces.

**Spec:** `docs/superpowers/specs/2026-08-28-corridor-case-foundations-design.md`

## Global Constraints

- **Never rename or extend `ROLES`.** `packages/contracts/src/roles.ts:9` is the source of truth shared with SQL CHECK constraints, RLS policies, and `infra/keycloak/realm-mir.json`. 299 references exist.
- **Never add a value to `LOCALES`.** `apps/api/migrations/0001_init.up.sql:54` and `0003_consent_terms.up.sql:21` both declare `CHECK (locale IN ('ar','fr'))`.
- **No country names or `*_doctor` literals** in `apps/web/app/**` or `apps/web/components/**`. Task 10 enforces this with a test.
- **No literal UI copy in contracts.** `FieldSpec` carries `labelKey`, a dictionary key — never a translated string.
- TypeScript is strict with `noUncheckedIndexedAccess`: indexing a `Record<K, V>` keyed by a literal union is safe, but indexing by `string` yields `V | undefined` and must be narrowed.
- Every task ends with its own tests passing and a commit.
- Final gate for the whole plan: `pnpm verify` from the repo root.

---

### Task 1: UI locale split (adds English for admin)

Brief §4.2 requires English for admin/internal UI. `LOCALES` cannot grow (Global Constraints), so the UI locale set is *derived from* the content locale set rather than replacing it. Deriving it makes "UI locales are a superset of content locales" structural instead of merely tested.

**Files:**
- Create: `packages/contracts/src/ui-locale.ts`
- Create: `packages/contracts/src/ui-locale.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `LOCALES`, `LOCALE_DIRECTION`, `Locale` from `./roles`.
- Produces: `UI_LOCALES`, `uiLocaleSchema`, `UiLocale`, `UI_LOCALE_DIRECTION`, `ADMIN_LOCALE`, `isContentLocale(locale: UiLocale): locale is Locale`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/ui-locale.test.ts
import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_DIRECTION } from './roles';
import {
  ADMIN_LOCALE,
  isContentLocale,
  UI_LOCALES,
  UI_LOCALE_DIRECTION,
  uiLocaleSchema,
} from './ui-locale';

describe('ui locales', () => {
  it('is a superset of the content locales, plus English for admin (§4.2)', () => {
    for (const locale of LOCALES) {
      expect(UI_LOCALES).toContain(locale);
    }
    expect(UI_LOCALES).toContain('en');
    expect(UI_LOCALES).toHaveLength(LOCALES.length + 1);
  });

  it('gives every UI locale a direction, agreeing with the content table', () => {
    for (const locale of LOCALES) {
      expect(UI_LOCALE_DIRECTION[locale]).toBe(LOCALE_DIRECTION[locale]);
    }
    expect(UI_LOCALE_DIRECTION.ar).toBe('rtl');
    expect(UI_LOCALE_DIRECTION.en).toBe('ltr');
  });

  it('accepts every UI locale and rejects anything else', () => {
    expect(uiLocaleSchema.parse('en')).toBe('en');
    expect(uiLocaleSchema.parse('ar')).toBe('ar');
    expect(() => uiLocaleSchema.parse('de')).toThrow();
  });

  it('distinguishes locales that may be persisted from ones that may not', () => {
    // The database CHECK constraint accepts only ar and fr. Writing 'en' to a
    // consent or user row would be rejected by Postgres, so the type guard is
    // the frontend's only defence against constructing that write.
    expect(isContentLocale('ar')).toBe(true);
    expect(isContentLocale('fr')).toBe(true);
    expect(isContentLocale(ADMIN_LOCALE)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/contracts test`
Expected: FAIL — `Failed to resolve import "./ui-locale"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/ui-locale.ts
import { z } from 'zod';
import { LOCALES, LOCALE_DIRECTION, type Locale } from './roles';

/**
 * UI locales — brief §4.2 (English for admin/internal use).
 *
 * WHY THIS IS NOT JUST `LOCALES + 'en'`.
 * `LOCALES` is mirrored by `CHECK (locale IN ('ar','fr'))` in two migrations:
 * the user row and the consent terms table. Adding English there would let the
 * type system hand Postgres a value it rejects at write time. So the content
 * locale set stays exactly as the database defines it, and the presentation
 * set is derived from it. The superset relationship is structural — you cannot
 * add a content locale without it appearing here.
 */

/** English is internal-facing only: admin and ops, never provider content. */
export const ADMIN_LOCALE = 'en' as const;

export const UI_LOCALES = [...LOCALES, ADMIN_LOCALE] as const;
export const uiLocaleSchema = z.enum(UI_LOCALES);
export type UiLocale = z.infer<typeof uiLocaleSchema>;

/**
 * Direction for every UI locale. `LOCALE_DIRECTION` is left alone because the
 * API and the Keycloak realm read it; this spreads it so the two tables cannot
 * disagree about Arabic.
 */
export const UI_LOCALE_DIRECTION: Record<UiLocale, 'rtl' | 'ltr'> = {
  ...LOCALE_DIRECTION,
  [ADMIN_LOCALE]: 'ltr',
};

/**
 * Narrows a UI locale to one that may be persisted. Call this before sending a
 * locale to any endpoint that stores it.
 */
export function isContentLocale(locale: UiLocale): locale is Locale {
  return (LOCALES as readonly string[]).includes(locale);
}
```

```ts
// packages/contracts/src/index.ts
export * from './roles';
export * from './ui-locale';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/contracts test && pnpm --filter @mir/contracts typecheck`
Expected: PASS, 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ui-locale.ts packages/contracts/src/ui-locale.test.ts packages/contracts/src/index.ts
git commit -m "Add UI locale set with English for admin (§4.2)"
```

---

### Task 2: Corridor contracts

The load-bearing task. Brief §4.3 forbids Libya/Tunisia as constants in UI copy, routing, or business logic. Rather than rename roles (impossible — Global Constraints), a corridor record declares which role plays which side, and all downstream code branches on `CaseSide`.

**Files:**
- Create: `packages/contracts/src/corridor.ts`
- Create: `packages/contracts/src/corridor.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `roleSchema`, `Role` from `./roles`.
- Produces: `CASE_SIDES`, `caseSideSchema`, `CaseSide`, `fieldSpecSchema`, `FieldSpec`, `corridorEndpointSchema`, `CorridorEndpoint`, `corridorSchema`, `Corridor`, `resolveSide(corridor, role)`, `corridorEndpointFor(corridor, side)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/corridor.test.ts
import { describe, expect, it } from 'vitest';
import {
  type Corridor,
  corridorEndpointFor,
  corridorSchema,
  resolveSide,
} from './corridor';

const corridor: Corridor = corridorSchema.parse({
  id: 'ly-tn',
  source: {
    country: 'LY',
    role: 'libya_doctor',
    licensingBodyKey: 'licensingBodyLyMedicalSyndicate',
    documentRequirements: [
      { key: 'licenceNumber', kind: 'text', required: true, labelKey: 'fieldLicenceNumber' },
    ],
  },
  destination: {
    country: 'TN',
    role: 'tunisia_doctor',
    licensingBodyKey: 'licensingBodyTnOrdreDesMedecins',
    documentRequirements: [
      { key: 'cnomNumber', kind: 'text', required: true, labelKey: 'fieldCnomNumber' },
    ],
  },
  intakeFields: [
    { key: 'referralReason', kind: 'text', required: true, labelKey: 'fieldReferralReason' },
  ],
  currencies: ['USD', 'EUR'],
});

describe('corridor', () => {
  it('maps each stored role onto the side it plays, never onto a country', () => {
    expect(resolveSide(corridor, 'libya_doctor')).toBe('source');
    expect(resolveSide(corridor, 'tunisia_doctor')).toBe('destination');
  });

  it('treats admin as ops on every corridor', () => {
    expect(resolveSide(corridor, 'admin')).toBe('ops');
  });

  it('gives patients no side — the platform serves organisations, not patients (§2)', () => {
    expect(resolveSide(corridor, 'patient')).toBeNull();
  });

  it('rejects a corridor whose two sides share a role, because the side would be ambiguous', () => {
    expect(() =>
      corridorSchema.parse({
        ...corridor,
        destination: { ...corridor.destination, role: 'libya_doctor' },
      }),
    ).toThrow(/same role/i);
  });

  it('requires at least one currency so a ledger can never be rendered without one', () => {
    expect(() => corridorSchema.parse({ ...corridor, currencies: [] })).toThrow();
  });

  it('resolves the endpoint for a side, so compliance copy is data not conditionals', () => {
    expect(corridorEndpointFor(corridor, 'source').licensingBodyKey).toBe(
      'licensingBodyLyMedicalSyndicate',
    );
    expect(corridorEndpointFor(corridor, 'destination').country).toBe('TN');
    expect(corridorEndpointFor(corridor, 'ops')).toBeNull();
  });

  it('carries dictionary keys rather than translated copy, so §4.2 still holds', () => {
    for (const field of corridor.intakeFields) {
      expect(field.labelKey).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/contracts test`
Expected: FAIL — `Failed to resolve import "./corridor"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/corridor.ts
import { z } from 'zod';
import { roleSchema, type Role } from './roles';

/**
 * Corridors — brief §4.3.
 *
 * WHY ROLES BECOME DATA INSTEAD OF BEING RENAMED.
 * §4.3 says no UI copy, routing, or business logic may assume Libya/Tunisia as
 * constants. The obvious fix — rename `libya_doctor` to `source_provider` — is
 * closed off: that identifier appears 299 times across RLS policies, two
 * migrations, and the Keycloak realm, and roles.ts says changing the set is
 * deliberately awkward because a new role is a new access path.
 *
 * So the role stays as the stored access subject, and the corridor says which
 * side it plays. Presentation code asks for a CaseSide and never learns the
 * country. Adding Morocco -> France is then a config object, not a code change.
 */

export const CASE_SIDES = ['source', 'destination', 'ops'] as const;
export const caseSideSchema = z.enum(CASE_SIDES);
export type CaseSide = z.infer<typeof caseSideSchema>;

/** The side a corridor endpoint can occupy. `ops` is platform staff, not an endpoint. */
export const ENDPOINT_SIDES = ['source', 'destination'] as const;
export type EndpointSide = (typeof ENDPOINT_SIDES)[number];

export const fieldKindSchema = z.enum([
  'text',
  'textarea',
  'date',
  'select',
  'file',
  'phone',
  'national_id',
]);
export type FieldKind = z.infer<typeof fieldKindSchema>;

/**
 * A form field described as data. `labelKey` is a dictionary key, never a
 * translated string — a corridor must not smuggle untranslatable copy past the
 * §4.2 catalogue.
 */
export const fieldSpecSchema = z.object({
  key: z.string().min(1),
  kind: fieldKindSchema,
  required: z.boolean(),
  labelKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'labelKey must be a dictionary key'),
  options: z.array(z.string().min(1)).optional(),
});
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const corridorEndpointSchema = z.object({
  /** ISO 3166-1 alpha-2. Displayed via the dictionary, never concatenated into copy. */
  country: z.string().length(2).regex(/^[A-Z]{2}$/),
  role: roleSchema,
  licensingBodyKey: z.string().min(1),
  documentRequirements: z.array(fieldSpecSchema),
});
export type CorridorEndpoint = z.infer<typeof corridorEndpointSchema>;

export const corridorSchema = z
  .object({
    id: z.string().min(1),
    source: corridorEndpointSchema,
    destination: corridorEndpointSchema,
    intakeFields: z.array(fieldSpecSchema),
    currencies: z.array(z.string().length(3).regex(/^[A-Z]{3}$/)).nonempty(),
  })
  .refine((c) => c.source.role !== c.destination.role, {
    message: 'a corridor cannot put the same role on both sides',
    path: ['destination', 'role'],
  });
export type Corridor = z.infer<typeof corridorSchema>;

/**
 * The side a role plays on a corridor, or null if it plays none.
 *
 * Patients return null deliberately: the platform's users are organisations
 * and professionals (§2), and a patient holds no side of a referral.
 */
export function resolveSide(corridor: Corridor, role: Role): CaseSide | null {
  if (role === 'admin') return 'ops';
  if (role === corridor.source.role) return 'source';
  if (role === corridor.destination.role) return 'destination';
  return null;
}

/** The endpoint record for a side. `ops` has no endpoint — it is platform staff. */
export function corridorEndpointFor(corridor: Corridor, side: CaseSide): CorridorEndpoint | null {
  if (side === 'source') return corridor.source;
  if (side === 'destination') return corridor.destination;
  return null;
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './corridor';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/contracts test && pnpm --filter @mir/contracts typecheck`
Expected: PASS, 7 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/corridor.ts packages/contracts/src/corridor.test.ts packages/contracts/src/index.ts
git commit -m "Add corridor contracts mapping roles to case sides (§4.3)"
```

---

### Task 3: Case status machine and case reference

Brief §5.3 requires status labels shown *consistently across provider and admin views*. A transition table in one place is what makes that true; scattered conditionals are what makes views drift apart. §5.2 requires a case reference number on the confirmation screen.

**Files:**
- Create: `packages/contracts/src/case.ts`
- Create: `packages/contracts/src/case.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `caseSideSchema` from `./corridor`.
- Produces: `CASE_STATUSES`, `caseStatusSchema`, `CaseStatus`, `canTransition(from, to)`, `nextStatuses(from)`, `isTerminalStatus(status)`, `caseRefSchema`, `CaseRef`, `formatCaseRef(year, sequence)`, `parseCaseRef(ref)`, `caseEventSchema`, `CaseEvent`, `caseSchema`, `Case`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/case.test.ts
import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  canTransition,
  caseSchema,
  formatCaseRef,
  isTerminalStatus,
  nextStatuses,
  parseCaseRef,
} from './case';

describe('case status', () => {
  it('carries the pipeline the brief names, in order (§5.3)', () => {
    expect(CASE_STATUSES.slice(0, 5)).toEqual([
      'submitted',
      'under_review',
      'matched',
      'in_progress',
      'completed',
    ]);
  });

  it('allows only forward moves along the pipeline', () => {
    expect(canTransition('submitted', 'under_review')).toBe(true);
    expect(canTransition('under_review', 'matched')).toBe(true);
    expect(canTransition('matched', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
  });

  it('refuses to skip or reverse a stage', () => {
    expect(canTransition('submitted', 'matched')).toBe(false);
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('matched', 'submitted')).toBe(false);
  });

  it('lets a live case be cancelled but never a finished one', () => {
    expect(canTransition('submitted', 'cancelled')).toBe(true);
    expect(canTransition('in_progress', 'cancelled')).toBe(true);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('rejected', 'cancelled')).toBe(false);
  });

  it('rejects only out of review, where the decision is actually made', () => {
    expect(canTransition('under_review', 'rejected')).toBe(true);
    expect(canTransition('in_progress', 'rejected')).toBe(false);
  });

  it('treats the three end states as terminal', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('rejected')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('submitted')).toBe(false);
  });

  it('offers the reachable statuses so admin override UI is generated, not hand-listed (§5.8)', () => {
    expect(nextStatuses('under_review')).toEqual(['matched', 'rejected', 'cancelled']);
    expect(nextStatuses('completed')).toEqual([]);
  });

  it('gives every status a transition entry, so no status can strand a case', () => {
    for (const status of CASE_STATUSES) {
      expect(Array.isArray(nextStatuses(status))).toBe(true);
    }
  });
});

describe('case reference', () => {
  it('formats the reference shown on the confirmation screen (§5.2)', () => {
    expect(formatCaseRef(2026, 417)).toBe('MIR-2026-0417');
    expect(formatCaseRef(2026, 1)).toBe('MIR-2026-0001');
  });

  it('round-trips', () => {
    expect(parseCaseRef('MIR-2026-0417')).toEqual({ year: 2026, sequence: 417 });
  });

  it('returns null rather than throwing when a provider mistypes a reference into search', () => {
    expect(parseCaseRef('MIR-26-417')).toBeNull();
    expect(parseCaseRef('nonsense')).toBeNull();
    expect(parseCaseRef('')).toBeNull();
  });

  it('refuses a sequence that will not fit, instead of silently truncating', () => {
    expect(() => formatCaseRef(2026, 10000)).toThrow(/sequence/i);
    expect(() => formatCaseRef(2026, 0)).toThrow(/sequence/i);
  });
});

describe('case', () => {
  it('owns the V0 records rather than replacing them', () => {
    const parsed = caseSchema.parse({
      ref: 'MIR-2026-0417',
      corridorId: 'ly-tn',
      status: 'in_progress',
      submittedByProviderId: 'prov-1',
      matchedProviderId: 'prov-2',
      patientId: 'pat-1',
      studyIds: ['study-1', 'study-2'],
      appointmentId: 'appt-1',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-04T11:30:00.000Z',
      intake: { referralReason: 'suspected meniscal tear' },
    });
    expect(parsed.studyIds).toHaveLength(2);
    expect(parsed.appointmentId).toBe('appt-1');
  });

  it('accepts a case that has not been matched or scheduled yet', () => {
    const parsed = caseSchema.parse({
      ref: 'MIR-2026-0418',
      corridorId: 'ly-tn',
      status: 'submitted',
      submittedByProviderId: 'prov-1',
      patientId: 'pat-1',
      studyIds: [],
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-01T09:00:00.000Z',
      intake: {},
    });
    expect(parsed.matchedProviderId).toBeUndefined();
    expect(parsed.appointmentId).toBeUndefined();
  });

  it('refuses a malformed reference', () => {
    expect(() =>
      caseSchema.parse({
        ref: 'CASE-1',
        corridorId: 'ly-tn',
        status: 'submitted',
        submittedByProviderId: 'prov-1',
        patientId: 'pat-1',
        studyIds: [],
        createdAt: '2026-08-01T09:00:00.000Z',
        updatedAt: '2026-08-01T09:00:00.000Z',
        intake: {},
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/contracts test`
Expected: FAIL — `Failed to resolve import "./case"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/case.ts
import { z } from 'zod';
import { caseSideSchema } from './corridor';

/**
 * The case pipeline — brief §5.3.
 *
 * WHY A TABLE RATHER THAN CONDITIONALS.
 * §5.3 requires status labels be shown "consistently across provider and admin
 * views". Two views that each decide for themselves what may follow
 * `under_review` will eventually disagree, and the disagreement will be
 * discovered by a clinic. One table, read by both, cannot drift. It also gives
 * the §5.8 admin override UI its options for free rather than by hand-listing
 * them somewhere a new status will be forgotten.
 */

export const CASE_STATUSES = [
  'submitted',
  'under_review',
  'matched',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
] as const;

export const caseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

/**
 * What may follow what. A terminal status maps to the empty list, which is what
 * `isTerminalStatus` reads — there is no second list to keep in sync.
 *
 * Cancellation is available from every live stage because a patient can
 * withdraw at any point before completion. It is NOT available from a finished
 * case: cancelling a completed case would silently undo a coordination fee.
 * Rejection is available only out of review, because that is the only stage
 * where the decision to reject is actually taken.
 */
const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  submitted: ['under_review', 'cancelled'],
  under_review: ['matched', 'rejected', 'cancelled'],
  matched: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: CaseStatus): readonly CaseStatus[] {
  return TRANSITIONS[from];
}

export function isTerminalStatus(status: CaseStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Case reference — brief §5.2, shown on the submission confirmation screen and
 * used by providers to talk about a case on the phone. Latin-script and
 * fixed-width on purpose: it has to stay readable inside Arabic RTL text (§4.2
 * mixed-direction content).
 */
const CASE_REF_PATTERN = /^MIR-(\d{4})-(\d{4})$/;
const MIN_SEQUENCE = 1;
const MAX_SEQUENCE = 9999;

export const caseRefSchema = z
  .string()
  .regex(CASE_REF_PATTERN, 'case reference must look like MIR-2026-0417');
export type CaseRef = z.infer<typeof caseRefSchema>;

export function formatCaseRef(year: number, sequence: number): CaseRef {
  if (!Number.isInteger(sequence) || sequence < MIN_SEQUENCE || sequence > MAX_SEQUENCE) {
    throw new RangeError(
      `case sequence must be an integer between ${MIN_SEQUENCE} and ${MAX_SEQUENCE}, got ${sequence}`,
    );
  }
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`case year must be a four-digit integer, got ${year}`);
  }
  return `MIR-${year}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Returns null rather than throwing: providers type references into search
 * boxes, and a typo there is ordinary input, not an exceptional condition.
 */
export function parseCaseRef(ref: string): { year: number; sequence: number } | null {
  const match = CASE_REF_PATTERN.exec(ref);
  if (match === null) return null;
  const [, year, sequence] = match;
  // noUncheckedIndexedAccess: the pattern guarantees both groups, but the
  // compiler cannot know that, so narrow rather than assert.
  if (year === undefined || sequence === undefined) return null;
  return { year: Number(year), sequence: Number(sequence) };
}

/**
 * One entry in the §5.3 status history. Also carries the §4.4 obligation to
 * surface audit-relevant actions back to the user: the actor and instant are
 * part of the record precisely so a view can render "changed by X on [date]".
 */
export const caseEventSchema = z.object({
  id: z.string().min(1),
  caseRef: caseRefSchema,
  occurredAt: z.string().datetime(),
  actorDisplayName: z.string().min(1),
  actorSide: caseSideSchema,
  from: caseStatusSchema.nullable(),
  to: caseStatusSchema,
  noteKey: z.string().optional(),
});
export type CaseEvent = z.infer<typeof caseEventSchema>;

/**
 * A case owns the V0 records rather than replacing them: the patient, the
 * uploaded studies, and the booked appointment all hang off the case, so the
 * existing imaging and scheduling work becomes what happens *inside* a case.
 *
 * `intake` is an open map because its shape is the corridor's `intakeFields`
 * (§4.3) — pinning it to a fixed schema here would hardcode one corridor's
 * form, which is exactly what the brief forbids.
 */
export const caseSchema = z.object({
  ref: caseRefSchema,
  corridorId: z.string().min(1),
  status: caseStatusSchema,
  submittedByProviderId: z.string().min(1),
  matchedProviderId: z.string().min(1).optional(),
  patientId: z.string().min(1),
  studyIds: z.array(z.string().min(1)),
  appointmentId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  intake: z.record(z.string(), z.unknown()),
});
export type Case = z.infer<typeof caseSchema>;
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './case';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/contracts test && pnpm --filter @mir/contracts typecheck`
Expected: PASS, 14 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/case.ts packages/contracts/src/case.test.ts packages/contracts/src/index.ts
git commit -m "Add case status machine and case reference (§5.2, §5.3)"
```

---

### Task 4: Provider and verification contracts

Brief §5.1 requires the provider to see pending/approved/rejected "with no need to contact the platform team", and §3 requires provider and admin to be structurally separate sign-up paths — not one form with a role dropdown.

**Files:**
- Create: `packages/contracts/src/provider.ts`
- Create: `packages/contracts/src/provider.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: nothing. `side` is narrowed to the two endpoint sides locally, so a provider can never be constructed on the `ops` side.
- Produces: `PROVIDER_KINDS`, `providerKindSchema`, `ProviderKind`, `VERIFICATION_STATUSES`, `verificationStatusSchema`, `VerificationStatus`, `providerVerificationSchema`, `ProviderVerification`, `providerSchema`, `Provider`, `canSubmitCases(provider)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/provider.test.ts
import { describe, expect, it } from 'vitest';
import {
  canSubmitCases,
  PROVIDER_KINDS,
  type Provider,
  providerSchema,
  VERIFICATION_STATUSES,
} from './provider';

const approved: Provider = providerSchema.parse({
  id: 'prov-1',
  kind: 'clinic',
  legalName: 'Tripoli Imaging Centre',
  corridorId: 'ly-tn',
  side: 'source',
  verification: {
    status: 'approved',
    submittedAt: '2026-07-01T09:00:00.000Z',
    decidedAt: '2026-07-03T12:00:00.000Z',
    credentials: { licenceNumber: 'LY-88213' },
  },
  seatCount: 4,
});

describe('provider', () => {
  it('covers the organisation kinds the brief names in §3', () => {
    expect(PROVIDER_KINDS).toContain('clinic');
    expect(PROVIDER_KINDS).toContain('laboratory');
    expect(PROVIDER_KINDS).toContain('doctor');
  });

  it('exposes the three states a provider must be able to see for themselves (§5.1)', () => {
    expect(VERIFICATION_STATUSES).toEqual(['pending', 'approved', 'rejected']);
  });

  it('lets only an approved provider submit cases', () => {
    expect(canSubmitCases(approved)).toBe(true);
  });

  it('blocks a pending provider from submitting, so the UI never offers the action (§4.4)', () => {
    const pending = providerSchema.parse({
      ...approved,
      verification: {
        status: 'pending',
        submittedAt: '2026-07-01T09:00:00.000Z',
        credentials: { licenceNumber: 'LY-88213' },
      },
    });
    expect(canSubmitCases(pending)).toBe(false);
  });

  it('blocks a rejected provider and keeps the reason key for display', () => {
    const rejected = providerSchema.parse({
      ...approved,
      verification: {
        status: 'rejected',
        submittedAt: '2026-07-01T09:00:00.000Z',
        decidedAt: '2026-07-03T12:00:00.000Z',
        reasonKey: 'verificationReasonLicenceExpired',
        credentials: { licenceNumber: 'LY-88213' },
      },
    });
    expect(canSubmitCases(rejected)).toBe(false);
    expect(rejected.verification.reasonKey).toBe('verificationReasonLicenceExpired');
  });

  it('requires a decision instant once a decision has been made', () => {
    expect(() =>
      providerSchema.parse({
        ...approved,
        verification: {
          status: 'approved',
          submittedAt: '2026-07-01T09:00:00.000Z',
          credentials: {},
        },
      }),
    ).toThrow(/decidedAt/i);
  });

  it('never puts a provider on the ops side — ops is platform staff, not a provider', () => {
    expect(() => providerSchema.parse({ ...approved, side: 'ops' })).toThrow();
  });

  it('requires at least one seat, since a clinic with no logins cannot work (§5.5)', () => {
    expect(() => providerSchema.parse({ ...approved, seatCount: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/contracts test`
Expected: FAIL — `Failed to resolve import "./provider"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/provider.ts
import { z } from 'zod';

/**
 * Providers — brief §3 and §5.1.
 *
 * A provider is an ORGANISATION, not a login. §5.5 asks for multi-seat access
 * within one clinic account, so seats are counted here and users reference a
 * provider rather than being one.
 */

export const PROVIDER_KINDS = ['clinic', 'laboratory', 'doctor'] as const;
export const providerKindSchema = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/**
 * §5.1 requires the provider to see this state without contacting the platform
 * team, which is why it is part of the provider record the frontend already
 * holds rather than something to be asked for.
 */
export const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const providerVerificationSchema = z
  .object({
    status: verificationStatusSchema,
    submittedAt: z.string().datetime(),
    decidedAt: z.string().datetime().optional(),
    /** Dictionary key, not copy — a rejection reason must translate (§4.2). */
    reasonKey: z.string().optional(),
    /** Shape comes from the corridor's documentRequirements (§4.3). */
    credentials: z.record(z.string(), z.unknown()),
  })
  .refine((v) => v.status === 'pending' || v.decidedAt !== undefined, {
    message: 'a decided verification must carry decidedAt',
    path: ['decidedAt'],
  });
export type ProviderVerification = z.infer<typeof providerVerificationSchema>;

export const providerSchema = z.object({
  id: z.string().min(1),
  kind: providerKindSchema,
  legalName: z.string().min(1),
  corridorId: z.string().min(1),
  /**
   * Only the two endpoint sides. `ops` is excluded structurally rather than by
   * validation message: platform staff are not a provider, and §3 requires the
   * two sign-up paths stay separate.
   */
  side: z.enum(['source', 'destination']),
  verification: providerVerificationSchema,
  seatCount: z.number().int().min(1),
});
export type Provider = z.infer<typeof providerSchema>;

/**
 * The single authority on whether case-submission affordances may be rendered.
 *
 * §4.4 requires the UI never show an affordance for an unauthorised action.
 * Routing every such check through one predicate is what stops the answer
 * being re-derived, and re-derived differently, on each screen.
 */
export function canSubmitCases(provider: Provider): boolean {
  return provider.verification.status === 'approved';
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './provider';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/contracts test && pnpm --filter @mir/contracts typecheck`
Expected: PASS, 8 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/provider.ts packages/contracts/src/provider.test.ts packages/contracts/src/index.ts
git commit -m "Add provider and verification contracts (§5.1)"
```

---

### Task 5: Ledger contracts

Brief §5.7 P0: coordination fees and SaaS subscription charges "should never be visually merged into one ambiguous 'amount owed' line". This task makes that a type-level guarantee rather than a review convention — there is no combined total to render because none exists.

**Files:**
- Create: `packages/contracts/src/ledger.ts`
- Create: `packages/contracts/src/ledger.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `caseRefSchema` from `./case`.
- Produces: `currencySchema`, `CurrencyCode`, `moneySchema`, `Money`, `PAYMENT_STATUSES`, `paymentStatusSchema`, `PaymentStatus`, `ledgerEntrySchema`, `LedgerEntry`, `CoordinationFeeEntry`, `SaasSubscriptionEntry`, `summariseLedger(entries)`, `LedgerSummary`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/ledger.test.ts
import { describe, expect, it } from 'vitest';
import { type LedgerEntry, ledgerEntrySchema, summariseLedger } from './ledger';

const entries: LedgerEntry[] = [
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-1',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-04T11:30:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'paid',
  }),
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-2',
    caseRef: 'MIR-2026-0418',
    occurredAt: '2026-08-06T09:00:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'pending',
  }),
  ledgerEntrySchema.parse({
    kind: 'saas_subscription',
    id: 'led-3',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.000Z',
    occurredAt: '2026-08-01T00:00:00.000Z',
    amount: { amountMinor: 9900, currency: 'EUR' },
    status: 'overdue',
  }),
];

describe('ledger entry', () => {
  it('links a coordination fee back to its case reference (§5.7)', () => {
    const [first] = entries;
    expect(first?.kind).toBe('coordination_fee');
    if (first?.kind === 'coordination_fee') {
      expect(first.caseRef).toBe('MIR-2026-0417');
    }
  });

  it('refuses a coordination fee with no case, since the fee is per completed case', () => {
    expect(() =>
      ledgerEntrySchema.parse({
        kind: 'coordination_fee',
        id: 'led-x',
        occurredAt: '2026-08-04T11:30:00.000Z',
        amount: { amountMinor: 25000, currency: 'USD' },
        status: 'paid',
      }),
    ).toThrow();
  });

  it('refuses a subscription charge carrying a case reference, which would blur the two', () => {
    const parsed = ledgerEntrySchema.parse({
      kind: 'saas_subscription',
      id: 'led-y',
      caseRef: 'MIR-2026-0417',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T23:59:59.000Z',
      occurredAt: '2026-08-01T00:00:00.000Z',
      amount: { amountMinor: 9900, currency: 'EUR' },
      status: 'paid',
    });
    expect(Object.hasOwn(parsed, 'caseRef')).toBe(false);
  });

  it('stores money in minor units so no total is ever computed in floating point', () => {
    expect(() =>
      ledgerEntrySchema.parse({
        kind: 'saas_subscription',
        id: 'led-z',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-31T23:59:59.000Z',
        occurredAt: '2026-08-01T00:00:00.000Z',
        amount: { amountMinor: 99.5, currency: 'EUR' },
        status: 'paid',
      }),
    ).toThrow();
  });
});

describe('summariseLedger', () => {
  it('keeps the two charge kinds apart (§5.7 P0)', () => {
    const summary = summariseLedger(entries);
    expect(summary.coordinationFees.USD?.amountMinor).toBe(50000);
    expect(summary.subscriptions.EUR?.amountMinor).toBe(9900);
  });

  it('exposes no combined total — the requirement is that none can be rendered', () => {
    const summary = summariseLedger(entries);
    expect(Object.hasOwn(summary, 'total')).toBe(false);
    expect(Object.hasOwn(summary, 'amountOwed')).toBe(false);
    expect(Object.hasOwn(summary, 'balance')).toBe(false);
  });

  it('groups by currency rather than summing across them (§5.7 multi-currency)', () => {
    const summary = summariseLedger([
      ...entries,
      ledgerEntrySchema.parse({
        kind: 'coordination_fee',
        id: 'led-4',
        caseRef: 'MIR-2026-0419',
        occurredAt: '2026-08-07T09:00:00.000Z',
        amount: { amountMinor: 20000, currency: 'EUR' },
        status: 'pending',
      }),
    ]);
    expect(summary.coordinationFees.USD?.amountMinor).toBe(50000);
    expect(summary.coordinationFees.EUR?.amountMinor).toBe(20000);
  });

  it('counts what is outstanding per kind, for the §5.7 payment status indicators', () => {
    const summary = summariseLedger(entries);
    expect(summary.outstanding.coordination_fee).toBe(1);
    expect(summary.outstanding.saas_subscription).toBe(1);
  });

  it('summarises an empty ledger without inventing a zero total', () => {
    const summary = summariseLedger([]);
    expect(summary.coordinationFees).toEqual({});
    expect(summary.subscriptions).toEqual({});
    expect(summary.outstanding.coordination_fee).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/contracts test`
Expected: FAIL — `Failed to resolve import "./ledger"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/ledger.ts
import { z } from 'zod';
import { caseRefSchema } from './case';

/**
 * The ledger — brief §5.7.
 *
 * WHY A DISCRIMINATED UNION.
 * §5.7 P0 says coordination fees and subscription charges must never be
 * merged into one ambiguous "amount owed". A shape with `amount` and a `type`
 * field satisfies that only as long as every future screen remembers to split
 * them. A union with no common total does not depend on anyone remembering:
 * there is no field to render, so the ambiguous line cannot be built by
 * accident. `summariseLedger` returns the same shape for the same reason.
 *
 * Money is minor units and an explicit currency. Amounts are never floats, and
 * never summed across currencies (§5.7 multi-currency) — the summary groups.
 */

export const currencySchema = z.enum(['USD', 'EUR', 'TND', 'LYD']);
export type CurrencyCode = z.infer<typeof currencySchema>;

export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

export const PAYMENT_STATUSES = ['paid', 'pending', 'overdue'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

const ledgerEntryBase = {
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  amount: moneySchema,
  status: paymentStatusSchema,
};

/** Per completed case, and therefore always carrying its case reference (§5.7 P1). */
export const coordinationFeeEntrySchema = z.object({
  ...ledgerEntryBase,
  kind: z.literal('coordination_fee'),
  caseRef: caseRefSchema,
});
export type CoordinationFeeEntry = z.infer<typeof coordinationFeeEntrySchema>;

/**
 * Per billing period, and deliberately carrying no case reference. Zod strips
 * unknown keys by default, so a `caseRef` supplied here is dropped rather than
 * preserved — the two kinds cannot be blurred even by a careless caller.
 */
export const saasSubscriptionEntrySchema = z.object({
  ...ledgerEntryBase,
  kind: z.literal('saas_subscription'),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type SaasSubscriptionEntry = z.infer<typeof saasSubscriptionEntrySchema>;

export const ledgerEntrySchema = z.discriminatedUnion('kind', [
  coordinationFeeEntrySchema,
  saasSubscriptionEntrySchema,
]);
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

type TotalsByCurrency = Partial<Record<CurrencyCode, Money>>;

/**
 * Deliberately has no `total`, `balance`, or `amountOwed`. See the union note
 * above — the omission is the feature.
 */
export interface LedgerSummary {
  coordinationFees: TotalsByCurrency;
  subscriptions: TotalsByCurrency;
  outstanding: Record<LedgerEntry['kind'], number>;
}

function addTo(totals: TotalsByCurrency, amount: Money): void {
  const existing = totals[amount.currency];
  totals[amount.currency] = {
    currency: amount.currency,
    amountMinor: (existing?.amountMinor ?? 0) + amount.amountMinor,
  };
}

export function summariseLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  const summary: LedgerSummary = {
    coordinationFees: {},
    subscriptions: {},
    outstanding: { coordination_fee: 0, saas_subscription: 0 },
  };

  for (const entry of entries) {
    const bucket =
      entry.kind === 'coordination_fee' ? summary.coordinationFees : summary.subscriptions;
    addTo(bucket, entry.amount);
    if (entry.status !== 'paid') {
      summary.outstanding[entry.kind] += 1;
    }
  }

  return summary;
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './ledger';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/contracts test && pnpm --filter @mir/contracts typecheck`
Expected: PASS, 9 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ledger.ts packages/contracts/src/ledger.test.ts packages/contracts/src/index.ts
git commit -m "Add ledger contracts keeping fee kinds structurally separate (§5.7)"
```

---

### Task 6: Messaging and notification contracts

Brief §5.6: messaging is scoped to a case, and notifications cover status changes, new messages, and new files.

**Files:**
- Create: `packages/contracts/src/messaging.ts`
- Create: `packages/contracts/src/messaging.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `caseRefSchema` from `./case`, `caseSideSchema` from `./corridor`.
- Produces: `messageSchema`, `Message`, `NOTIFICATION_KINDS`, `notificationKindSchema`, `NotificationKind`, `notificationSchema`, `Notification`, `unreadCount(notifications)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/messaging.test.ts
import { describe, expect, it } from 'vitest';
import {
  messageSchema,
  NOTIFICATION_KINDS,
  notificationSchema,
  unreadCount,
} from './messaging';

const base = {
  id: 'msg-1',
  caseRef: 'MIR-2026-0417',
  authorSide: 'source',
  authorDisplayName: 'Dr. Amal',
  body: 'Films uploaded, please review.',
  sentAt: '2026-08-04T11:30:00.000Z',
};

describe('message', () => {
  it('is scoped to a case, never free-floating (§5.6)', () => {
    expect(messageSchema.parse(base).caseRef).toBe('MIR-2026-0417');
    expect(() => messageSchema.parse({ ...base, caseRef: undefined })).toThrow();
  });

  it('records delivery and read instants separately (§5.6 P1)', () => {
    const parsed = messageSchema.parse({
      ...base,
      deliveredAt: '2026-08-04T11:30:05.000Z',
      readAt: '2026-08-04T11:45:00.000Z',
    });
    expect(parsed.deliveredAt).toBeDefined();
    expect(parsed.readAt).toBeDefined();
  });

  it('refuses a message read before it was delivered', () => {
    expect(() =>
      messageSchema.parse({
        ...base,
        deliveredAt: '2026-08-04T11:45:00.000Z',
        readAt: '2026-08-04T11:30:05.000Z',
      }),
    ).toThrow(/readAt/i);
  });

  it('refuses an empty message body', () => {
    expect(() => messageSchema.parse({ ...base, body: '   ' })).toThrow();
  });
});

describe('notification', () => {
  it('covers the three triggers the brief names (§5.6 P0)', () => {
    expect(NOTIFICATION_KINDS).toEqual(['case_status_changed', 'message_received', 'file_added']);
  });

  it('counts only unread ones, for the §5.6 notification centre badge', () => {
    const notifications = [
      notificationSchema.parse({
        id: 'n1',
        kind: 'message_received',
        caseRef: 'MIR-2026-0417',
        occurredAt: '2026-08-04T11:30:00.000Z',
        titleKey: 'notifMessageReceived',
      }),
      notificationSchema.parse({
        id: 'n2',
        kind: 'file_added',
        caseRef: 'MIR-2026-0417',
        occurredAt: '2026-08-04T12:00:00.000Z',
        titleKey: 'notifFileAdded',
        readAt: '2026-08-04T12:05:00.000Z',
      }),
    ];
    expect(unreadCount(notifications)).toBe(1);
    expect(unreadCount([])).toBe(0);
  });

  it('carries a dictionary key rather than rendered copy, so it translates (§4.2)', () => {
    expect(() =>
      notificationSchema.parse({
        id: 'n3',
        kind: 'file_added',
        caseRef: 'MIR-2026-0417',
        occurredAt: '2026-08-04T12:00:00.000Z',
        titleKey: 'A new file was added',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/contracts test`
Expected: FAIL — `Failed to resolve import "./messaging"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/messaging.ts
import { z } from 'zod';
import { caseRefSchema } from './case';
import { caseSideSchema } from './corridor';

/**
 * Messaging and notifications — brief §5.6.
 *
 * Messages are scoped to a case by construction: `caseRef` is required, so a
 * message that belongs to no case cannot be represented. That is what keeps
 * §5.6's "scoped to a case" from depending on a query filter someone forgets.
 *
 * Author identity is a SIDE plus a display name, not a country or a role —
 * §4.3 again. A view renders "the destination clinic replied" without ever
 * learning which country that is.
 */

export const messageSchema = z
  .object({
    id: z.string().min(1),
    caseRef: caseRefSchema,
    authorSide: caseSideSchema,
    authorDisplayName: z.string().min(1),
    body: z.string().trim().min(1),
    sentAt: z.string().datetime(),
    deliveredAt: z.string().datetime().optional(),
    readAt: z.string().datetime().optional(),
  })
  .refine(
    (m) =>
      m.readAt === undefined ||
      (m.deliveredAt !== undefined && Date.parse(m.readAt) >= Date.parse(m.deliveredAt)),
    { message: 'readAt cannot precede deliveredAt', path: ['readAt'] },
  );
export type Message = z.infer<typeof messageSchema>;

/** The three triggers §5.6 P0 names. */
export const NOTIFICATION_KINDS = [
  'case_status_changed',
  'message_received',
  'file_added',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.string().min(1),
  kind: notificationKindSchema,
  caseRef: caseRefSchema,
  occurredAt: z.string().datetime(),
  /** Dictionary key, not copy. Same rule as FieldSpec.labelKey. */
  titleKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'titleKey must be a dictionary key'),
  readAt: z.string().datetime().optional(),
});
export type Notification = z.infer<typeof notificationSchema>;

export function unreadCount(notifications: readonly Notification[]): number {
  return notifications.filter((n) => n.readAt === undefined).length;
}
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './messaging';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/contracts test && pnpm --filter @mir/contracts typecheck && pnpm --filter @mir/contracts build`
Expected: PASS, 7 new tests; build emits `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/messaging.ts packages/contracts/src/messaging.test.ts packages/contracts/src/index.ts
git commit -m "Add case-scoped messaging and notification contracts (§5.6)"
```

---

### Task 7: English dictionary and UI-locale-aware provider

Brief §4.2 requires English for admin/internal use. Two things block it today: `vitest.config.ts` collects only `app/**` and `src/**`, so nothing under `lib/` is tested at all; and `LocaleProvider` is typed to `Locale`, which by Global Constraints can never include English.

**Files:**
- Modify: `apps/web/vitest.config.ts`
- Modify: `apps/web/lib/i18n/dictionary.ts`
- Modify: `apps/web/lib/i18n/provider.tsx`
- Create: `apps/web/lib/i18n/dictionary.test.ts`

**Interfaces:**
- Consumes: `UI_LOCALES`, `UI_LOCALE_DIRECTION`, `uiLocaleSchema`, `UiLocale`, `isContentLocale` from `@mir/contracts` (Task 1).
- Produces: `DICTIONARIES: Record<UiLocale, Dictionary>`, `LOCALE_NAMES: Record<UiLocale, string>`, `useLocale(): { locale: UiLocale; dir; setLocale; t }`, `useContentLocale(): Locale`.

- [ ] **Step 1: Extend the Vitest include so `lib/` is testable at all**

In `apps/web/vitest.config.ts`, replace the `include` array:

```ts
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
      'lib/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
    ],
```

Leave the `exclude` array and the Playwright comment above it exactly as they are.

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/lib/i18n/dictionary.test.ts
import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from '@mir/contracts';
import { DICTIONARIES, LOCALE_NAMES } from './dictionary';

describe('dictionaries', () => {
  it('ships one dictionary per UI locale, including English for admin (§4.2)', () => {
    for (const locale of UI_LOCALES) {
      expect(DICTIONARIES[locale]).toBeDefined();
    }
    expect(DICTIONARIES.en).toBeDefined();
  });

  it('gives every locale exactly the same keys, so none can ship half-translated', () => {
    const reference = Object.keys(DICTIONARIES.ar).sort();
    for (const locale of UI_LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort()).toEqual(reference);
    }
  });

  it('leaves no value empty', () => {
    for (const locale of UI_LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) {
        expect(value, `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('names every locale in its own language, for the language switcher', () => {
    for (const locale of UI_LOCALES) {
      expect(LOCALE_NAMES[locale]).toBeTruthy();
    }
    expect(LOCALE_NAMES.en).toBe('English');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mir/web test`
Expected: FAIL — `DICTIONARIES.en` is undefined, and the key-parity assertion fails.

- [ ] **Step 4: Add the English dictionary**

In `apps/web/lib/i18n/dictionary.ts`, add an `en` table after `fr`. It is declared with the same `Dictionary` type as `fr` already is, so the compiler reports any of the 175 keys you miss:

```ts
const en: Dictionary = {
  appName: 'MIR',
  appTagline: 'Cross-border medical imaging transfer',
  // ... one entry per key in `ar`, in the same order.
};
```

Translate every key present in `ar`. Do not invent keys, do not reorder, and do not leave any value as the Arabic or French original. Then update the two exported maps:

```ts
export const DICTIONARIES: Record<UiLocale, Dictionary> = { ar, fr, en };

export const LOCALE_NAMES: Record<UiLocale, string> = {
  ar: 'العربية',
  fr: 'Français',
  en: 'English',
};
```

Update the import at the top of the file from `import type { Locale } from '@mir/contracts';` to `import type { UiLocale } from '@mir/contracts';`.

- [ ] **Step 5: Make the provider UI-locale aware**

In `apps/web/lib/i18n/provider.tsx`:

- Change the import to `import { isContentLocale, UI_LOCALE_DIRECTION, uiLocaleSchema, type Locale, type UiLocale } from '@mir/contracts';`
- Change `DEFAULT_LOCALE: Locale` to `DEFAULT_LOCALE: UiLocale` (value stays `'ar'`).
- Change `LocaleContextValue.locale` to `UiLocale` and `setLocale` to take `UiLocale`.
- Replace both `LOCALE_DIRECTION[...]` reads with `UI_LOCALE_DIRECTION[...]`.
- Replace `localeSchema.safeParse(stored)` with `uiLocaleSchema.safeParse(stored)`.
- In `useDateFormat`, replace the ternary with an explicit map so a third locale is a compile error rather than a silent fallback to French:

```ts
const DATE_LOCALE: Record<UiLocale, string> = { ar: 'ar-LY', fr: 'fr-TN', en: 'en-GB' };
```
and format with `new Intl.DateTimeFormat(DATE_LOCALE[locale], { ... })`, leaving the existing options and the `timeZoneName: 'short'` comment untouched.

- Add a hook that narrows to a persistable locale, so no caller can send `'en'` to an endpoint that stores it:

```ts
/**
 * The locale safe to PERSIST. English is presentation-only: the user and
 * consent tables both declare CHECK (locale IN ('ar','fr')), so a request
 * carrying 'en' would be rejected by Postgres. Admin screens run in English
 * while still writing Arabic — the platform default — to content rows.
 */
export function useContentLocale(): Locale {
  const { locale } = useLocale();
  return isContentLocale(locale) ? locale : 'ar';
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @mir/contracts build && pnpm --filter @mir/web test && pnpm --filter @mir/web typecheck`
Expected: PASS, 4 new tests. Typecheck must be clean — a missing English key surfaces here.

- [ ] **Step 7: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/lib/i18n/
git commit -m "Add English UI locale for admin, and test lib/ at all (§4.2)"
```

---

### Task 8: Corridor registry and intake field registry

The corridor *type* exists (Task 2); this makes the Libya–Tunisia corridor a config record and gives the UI a lookup. This is the file that would gain a second entry when the platform expands — and the only file that would.

**Files:**
- Create: `apps/web/lib/corridor/registry.ts`
- Create: `apps/web/lib/corridor/registry.test.ts`

**Interfaces:**
- Consumes: `corridorSchema`, `Corridor`, `resolveSide`, `CaseSide`, `Role` from `@mir/contracts` (Task 2).
- Produces: `CORRIDORS: readonly Corridor[]`, `DEFAULT_CORRIDOR_ID`, `getCorridor(id): Corridor | null`, `corridorForRole(role): Corridor | null`, `sideForRole(role): CaseSide | null`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/corridor/registry.test.ts
import { describe, expect, it } from 'vitest';
import { corridorSchema } from '@mir/contracts';
import {
  CORRIDORS,
  corridorForRole,
  DEFAULT_CORRIDOR_ID,
  getCorridor,
  sideForRole,
} from './registry';

describe('corridor registry', () => {
  it('holds only valid corridors', () => {
    for (const corridor of CORRIDORS) {
      expect(() => corridorSchema.parse(corridor)).not.toThrow();
    }
    expect(CORRIDORS.length).toBeGreaterThan(0);
  });

  it('has a default corridor that actually exists', () => {
    expect(getCorridor(DEFAULT_CORRIDOR_ID)).not.toBeNull();
  });

  it('returns null for an unknown corridor rather than throwing', () => {
    expect(getCorridor('ma-fr')).toBeNull();
  });

  it('finds the corridor a role belongs to, so no screen hardcodes one', () => {
    expect(corridorForRole('libya_doctor')?.id).toBe(DEFAULT_CORRIDOR_ID);
    expect(corridorForRole('tunisia_doctor')?.id).toBe(DEFAULT_CORRIDOR_ID);
  });

  it('resolves a role to its side', () => {
    expect(sideForRole('libya_doctor')).toBe('source');
    expect(sideForRole('tunisia_doctor')).toBe('destination');
    expect(sideForRole('admin')).toBe('ops');
    expect(sideForRole('patient')).toBeNull();
  });

  it('assigns each non-admin role to exactly one corridor side', () => {
    const sides = CORRIDORS.flatMap((c) => [c.source.role, c.destination.role]);
    expect(new Set(sides).size).toBe(sides.length);
  });

  it('references intake labels by dictionary key only', () => {
    for (const corridor of CORRIDORS) {
      const fields = [
        ...corridor.intakeFields,
        ...corridor.source.documentRequirements,
        ...corridor.destination.documentRequirements,
      ];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(field.labelKey).toMatch(/^[a-z][A-Za-z0-9]*$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/web test`
Expected: FAIL — `Failed to resolve import "./registry"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/lib/corridor/registry.ts
import {
  corridorSchema,
  resolveSide,
  type CaseSide,
  type Corridor,
  type Role,
} from '@mir/contracts';

/**
 * Configured corridors — brief §4.3.
 *
 * This is the ONLY file that names a country. Everything downstream asks the
 * registry for a side and renders from dictionary keys, which is what makes
 * expansion a new entry here rather than a sweep through screens.
 *
 * Parsed at module load rather than trusted: a malformed corridor should fail
 * on the first render in development, not on the one screen that reads the
 * field nobody tested.
 */

const LIBYA_TUNISIA: Corridor = corridorSchema.parse({
  id: 'ly-tn',
  source: {
    country: 'LY',
    role: 'libya_doctor',
    licensingBodyKey: 'licensingBodyLyMedicalSyndicate',
    documentRequirements: [
      { key: 'licenceNumber', kind: 'text', required: true, labelKey: 'fieldLicenceNumber' },
      { key: 'facilityPermit', kind: 'file', required: true, labelKey: 'fieldFacilityPermit' },
    ],
  },
  destination: {
    country: 'TN',
    role: 'tunisia_doctor',
    licensingBodyKey: 'licensingBodyTnOrdreDesMedecins',
    documentRequirements: [
      { key: 'cnomNumber', kind: 'text', required: true, labelKey: 'fieldCnomNumber' },
      { key: 'facilityPermit', kind: 'file', required: true, labelKey: 'fieldFacilityPermit' },
    ],
  },
  intakeFields: [
    { key: 'referralReason', kind: 'textarea', required: true, labelKey: 'fieldReferralReason' },
    {
      key: 'urgency',
      kind: 'select',
      required: true,
      labelKey: 'fieldUrgency',
      options: ['routine', 'soon', 'urgent'],
    },
    { key: 'preferredDate', kind: 'date', required: false, labelKey: 'fieldPreferredDate' },
  ],
  currencies: ['USD', 'EUR'],
});

export const CORRIDORS: readonly Corridor[] = [LIBYA_TUNISIA];

export const DEFAULT_CORRIDOR_ID = LIBYA_TUNISIA.id;

export function getCorridor(id: string): Corridor | null {
  return CORRIDORS.find((c) => c.id === id) ?? null;
}

/**
 * Admin belongs to no single corridor — it is ops across all of them — so this
 * returns null for admin. Use `sideForRole` when you only need the side.
 */
export function corridorForRole(role: Role): Corridor | null {
  return CORRIDORS.find((c) => c.source.role === role || c.destination.role === role) ?? null;
}

export function sideForRole(role: Role): CaseSide | null {
  const corridor = corridorForRole(role) ?? CORRIDORS[0];
  if (corridor === undefined) return null;
  return resolveSide(corridor, role);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mir/web test && pnpm --filter @mir/web typecheck`
Expected: PASS, 7 new tests.

- [ ] **Step 5: Add the field dictionary keys**

The registry references eight dictionary keys that do not exist yet. Add them to all three locales in `apps/web/lib/i18n/dictionary.ts` (`fieldLicenceNumber`, `fieldFacilityPermit`, `fieldCnomNumber`, `fieldReferralReason`, `fieldUrgency`, `fieldPreferredDate`, `licensingBodyLyMedicalSyndicate`, `licensingBodyTnOrdreDesMedecins`). Add them to `ar` first so they enter the `Dictionary` type, then `fr` and `en` — the compiler will demand both.

- [ ] **Step 6: Run the full web test suite**

Run: `pnpm --filter @mir/web test && pnpm --filter @mir/web typecheck`
Expected: PASS, including the Task 7 key-parity test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/corridor/ apps/web/lib/i18n/dictionary.ts
git commit -m "Add corridor registry as the only file naming a country (§4.3)"
```

---

### Task 9: Mock API layer

Spec §C. Screens built in later slices need something to render against, and the backend team needs a contract that has already been exercised. The mock lives behind the same typed surface as the real client, so swapping is a single module change.

**Files:**
- Create: `apps/web/lib/api/cases.ts`
- Create: `apps/web/lib/api/mock/fixtures.ts`
- Create: `apps/web/lib/api/mock/mock-cases.ts`
- Create: `apps/web/lib/api/mock/mock-cases.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6, plus `CORRIDORS`/`DEFAULT_CORRIDOR_ID` from Task 8.
- Produces: `CasesApi` (interface), `casesApi: CasesApi`, `isMockMode(): boolean`, and fixtures `FIXTURE_PROVIDERS`, `FIXTURE_CASES`, `FIXTURE_LEDGER`, `FIXTURE_MESSAGES`, `FIXTURE_NOTIFICATIONS`, `FIXTURE_EVENTS`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/api/mock/mock-cases.test.ts
import { describe, expect, it } from 'vitest';
import { canTransition, summariseLedger } from '@mir/contracts';
import { mockCasesApi } from './mock-cases';

describe('mock cases api', () => {
  it('lists cases visible to a side, and never cases from another provider', async () => {
    const all = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect([c.submittedByProviderId, c.matchedProviderId]).toContain('prov-source-1');
    }
  });

  it('filters by status, for the §5.3 provider case list', async () => {
    const completed = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      status: 'completed',
    });
    for (const c of completed) {
      expect(c.status).toBe('completed');
    }
  });

  it('finds a case by its reference number, the way a provider searches (§5.3)', async () => {
    const [first] = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(first).toBeDefined();
    if (first === undefined) return;
    const found = await mockCasesApi.getCase(first.ref);
    expect(found?.ref).toBe(first.ref);
  });

  it('returns null for an unknown reference rather than throwing', async () => {
    expect(await mockCasesApi.getCase('MIR-1999-0001')).toBeNull();
  });

  it('returns a timeline whose transitions are all legal (§5.3)', async () => {
    const [first] = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(first).toBeDefined();
    if (first === undefined) return;
    const events = await mockCasesApi.listCaseEvents(first.ref);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.from !== null) {
        expect(canTransition(event.from, event.to)).toBe(true);
      }
    }
  });

  it('orders the timeline oldest first, so a history reads downward', async () => {
    const [first] = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    if (first === undefined) return;
    const events = await mockCasesApi.listCaseEvents(first.ref);
    const times = events.map((e) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('serves a ledger that summarises into separate fee kinds (§5.7)', async () => {
    const entries = await mockCasesApi.listLedger('prov-source-1');
    const summary = summariseLedger(entries);
    expect(Object.keys(summary.coordinationFees).length).toBeGreaterThan(0);
    expect(Object.keys(summary.subscriptions).length).toBeGreaterThan(0);
  });

  it('scopes messages to one case (§5.6)', async () => {
    const messages = await mockCasesApi.listMessages('MIR-2026-0417');
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.caseRef).toBe('MIR-2026-0417');
    }
  });

  it('reports the verification state a provider must see for themselves (§5.1)', async () => {
    const pending = await mockCasesApi.getProvider('prov-source-2');
    expect(pending?.verification.status).toBe('pending');
  });

  it('lists the admin approval queue as pending providers only (§5.1, §5.8)', async () => {
    const queue = await mockCasesApi.listVerificationQueue();
    expect(queue.length).toBeGreaterThan(0);
    for (const provider of queue) {
      expect(provider.verification.status).toBe('pending');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mir/web test`
Expected: FAIL — `Failed to resolve import "./mock-cases"`.

- [ ] **Step 3: Write the fixtures**

```ts
// apps/web/lib/api/mock/fixtures.ts
import {
  caseEventSchema,
  caseSchema,
  ledgerEntrySchema,
  messageSchema,
  notificationSchema,
  providerSchema,
  type Case,
  type CaseEvent,
  type LedgerEntry,
  type Message,
  type Notification,
  type Provider,
} from '@mir/contracts';
import { DEFAULT_CORRIDOR_ID } from '../../corridor/registry';

/**
 * Synthetic fixtures. Every record is parsed through its schema at module load,
 * so a fixture that drifts from the contract fails the test run rather than
 * teaching a screen to render a shape the real API will never send.
 *
 * Patient names are invented. This repo has a `check:synthetic` gate; nothing
 * here may resemble real patient data.
 */

export const FIXTURE_PROVIDERS: readonly Provider[] = [
  providerSchema.parse({
    id: 'prov-source-1',
    kind: 'clinic',
    legalName: 'Andalus Diagnostic Centre',
    corridorId: DEFAULT_CORRIDOR_ID,
    side: 'source',
    verification: {
      status: 'approved',
      submittedAt: '2026-06-01T09:00:00.000Z',
      decidedAt: '2026-06-03T10:00:00.000Z',
      credentials: { licenceNumber: 'LY-88213' },
    },
    seatCount: 4,
  }),
  providerSchema.parse({
    id: 'prov-source-2',
    kind: 'laboratory',
    legalName: 'Sabratha Medical Laboratory',
    corridorId: DEFAULT_CORRIDOR_ID,
    side: 'source',
    verification: {
      status: 'pending',
      submittedAt: '2026-08-20T09:00:00.000Z',
      credentials: { licenceNumber: 'LY-90114' },
    },
    seatCount: 2,
  }),
  providerSchema.parse({
    id: 'prov-dest-1',
    kind: 'clinic',
    legalName: 'Clinique Les Oliviers',
    corridorId: DEFAULT_CORRIDOR_ID,
    side: 'destination',
    verification: {
      status: 'approved',
      submittedAt: '2026-05-11T09:00:00.000Z',
      decidedAt: '2026-05-12T14:00:00.000Z',
      credentials: { cnomNumber: 'TN-4471' },
    },
    seatCount: 6,
  }),
];

export const FIXTURE_CASES: readonly Case[] = [
  caseSchema.parse({
    ref: 'MIR-2026-0417',
    corridorId: DEFAULT_CORRIDOR_ID,
    status: 'in_progress',
    submittedByProviderId: 'prov-source-1',
    matchedProviderId: 'prov-dest-1',
    patientId: 'pat-fixture-1',
    studyIds: ['study-fixture-1'],
    appointmentId: 'appt-fixture-1',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-06T11:30:00.000Z',
    intake: { referralReason: 'Suspected meniscal tear', urgency: 'soon' },
  }),
  caseSchema.parse({
    ref: 'MIR-2026-0418',
    corridorId: DEFAULT_CORRIDOR_ID,
    status: 'submitted',
    submittedByProviderId: 'prov-source-1',
    patientId: 'pat-fixture-2',
    studyIds: [],
    createdAt: '2026-08-24T08:15:00.000Z',
    updatedAt: '2026-08-24T08:15:00.000Z',
    intake: { referralReason: 'Persistent headache, MRI requested', urgency: 'routine' },
  }),
  caseSchema.parse({
    ref: 'MIR-2026-0402',
    corridorId: DEFAULT_CORRIDOR_ID,
    status: 'completed',
    submittedByProviderId: 'prov-source-1',
    matchedProviderId: 'prov-dest-1',
    patientId: 'pat-fixture-3',
    studyIds: ['study-fixture-2', 'study-fixture-3'],
    appointmentId: 'appt-fixture-2',
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-29T16:45:00.000Z',
    intake: { referralReason: 'Post-operative follow-up', urgency: 'routine' },
  }),
];

export const FIXTURE_EVENTS: readonly CaseEvent[] = [
  caseEventSchema.parse({
    id: 'ev-1',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-01T09:00:00.000Z',
    actorDisplayName: 'Andalus Diagnostic Centre',
    actorSide: 'source',
    from: null,
    to: 'submitted',
  }),
  caseEventSchema.parse({
    id: 'ev-2',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-02T13:20:00.000Z',
    actorDisplayName: 'Platform ops',
    actorSide: 'ops',
    from: 'submitted',
    to: 'under_review',
  }),
  caseEventSchema.parse({
    id: 'ev-3',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-03T08:40:00.000Z',
    actorDisplayName: 'Platform ops',
    actorSide: 'ops',
    from: 'under_review',
    to: 'matched',
  }),
  caseEventSchema.parse({
    id: 'ev-4',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    actorDisplayName: 'Clinique Les Oliviers',
    actorSide: 'destination',
    from: 'matched',
    to: 'in_progress',
  }),
];

export const FIXTURE_LEDGER: readonly LedgerEntry[] = [
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-1',
    caseRef: 'MIR-2026-0402',
    occurredAt: '2026-07-29T16:45:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'paid',
  }),
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-2',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'pending',
  }),
  ledgerEntrySchema.parse({
    kind: 'saas_subscription',
    id: 'led-3',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.000Z',
    occurredAt: '2026-08-01T00:00:00.000Z',
    amount: { amountMinor: 9900, currency: 'EUR' },
    status: 'overdue',
  }),
];

export const FIXTURE_MESSAGES: readonly Message[] = [
  messageSchema.parse({
    id: 'msg-1',
    caseRef: 'MIR-2026-0417',
    authorSide: 'source',
    authorDisplayName: 'Dr. Amal Ben Salah',
    body: 'Films uploaded. Please confirm they are readable.',
    sentAt: '2026-08-04T11:30:00.000Z',
    deliveredAt: '2026-08-04T11:30:05.000Z',
    readAt: '2026-08-04T12:02:00.000Z',
  }),
  messageSchema.parse({
    id: 'msg-2',
    caseRef: 'MIR-2026-0417',
    authorSide: 'destination',
    authorDisplayName: 'Dr. Youssef Trabelsi',
    body: 'Received and readable. Booking the consultation for next week.',
    sentAt: '2026-08-04T12:10:00.000Z',
    deliveredAt: '2026-08-04T12:10:03.000Z',
  }),
];

export const FIXTURE_NOTIFICATIONS: readonly Notification[] = [
  notificationSchema.parse({
    id: 'notif-1',
    kind: 'message_received',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-04T12:10:03.000Z',
    titleKey: 'notifMessageReceived',
  }),
  notificationSchema.parse({
    id: 'notif-2',
    kind: 'case_status_changed',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    titleKey: 'notifCaseStatusChanged',
    readAt: '2026-08-06T12:00:00.000Z',
  }),
];
```

- [ ] **Step 4: Write the surface the mock implements**

```ts
// apps/web/lib/api/cases.ts
import type {
  Case,
  CaseEvent,
  CaseStatus,
  LedgerEntry,
  Message,
  Notification,
  Provider,
} from '@mir/contracts';

/**
 * The case-layer API surface.
 *
 * One interface, two implementations. Screens import the surface and never
 * learn which one they got, so replacing fixtures with the real client is a
 * change to this file alone.
 */

export interface ListCasesQuery {
  providerId: string;
  status?: CaseStatus;
  /** Matches on case reference — the §5.3 provider search. */
  search?: string;
}

export interface CasesApi {
  listCases(query: ListCasesQuery): Promise<Case[]>;
  getCase(ref: string): Promise<Case | null>;
  listCaseEvents(ref: string): Promise<CaseEvent[]>;
  listLedger(providerId: string): Promise<LedgerEntry[]>;
  listMessages(ref: string): Promise<Message[]>;
  listNotifications(): Promise<Notification[]>;
  getProvider(id: string): Promise<Provider | null>;
  listVerificationQueue(): Promise<Provider[]>;
  /** §5.8: the ops pipeline across all providers, not one provider's list. */
  listAllCases(status?: CaseStatus): Promise<Case[]>;
}

/**
 * Defaults to LIVE. A missing or misspelled environment variable must never
 * silently serve fixtures to a clinic — the failure mode of the opposite
 * default is invented patients on a real screen.
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_MIR_API_MODE === 'mock';
}
```

No `casesApi` selector is exported yet: the live implementation arrives with the
module slices, and a selector that can only ever return the mock would invite
screens to be written against fixtures. This task's deliverable is the contract
plus a mock proven against it.

- [ ] **Step 5: Write the mock API**

```ts
// apps/web/lib/api/mock/mock-cases.ts
import type {
  Case,
  CaseEvent,
  CaseStatus,
  LedgerEntry,
  Message,
  Notification,
  Provider,
} from '@mir/contracts';
import type { CasesApi, ListCasesQuery } from '../cases';
import {
  FIXTURE_CASES,
  FIXTURE_EVENTS,
  FIXTURE_LEDGER,
  FIXTURE_MESSAGES,
  FIXTURE_NOTIFICATIONS,
  FIXTURE_PROVIDERS,
} from './fixtures';

/**
 * Fixture-backed implementation of CasesApi.
 *
 * Async on purpose even though nothing awaits: screens written against this
 * must handle loading states, or they will all need rewriting the day the real
 * client lands.
 *
 * The provider filter mirrors what the backend's RLS will enforce. It is here
 * so a screen developed against mocks cannot accidentally rely on seeing
 * another provider's cases.
 */

function visibleTo(item: Case, providerId: string): boolean {
  return item.submittedByProviderId === providerId || item.matchedProviderId === providerId;
}

export const mockCasesApi: CasesApi = {
  async listCases(query: ListCasesQuery): Promise<Case[]> {
    return FIXTURE_CASES.filter(
      (c) =>
        visibleTo(c, query.providerId) &&
        (query.status === undefined || c.status === query.status) &&
        (query.search === undefined ||
          c.ref.toLowerCase().includes(query.search.toLowerCase())),
    ).slice();
  },

  async getCase(ref: string): Promise<Case | null> {
    return FIXTURE_CASES.find((c) => c.ref === ref) ?? null;
  },

  async listCaseEvents(ref: string): Promise<CaseEvent[]> {
    return FIXTURE_EVENTS.filter((e) => e.caseRef === ref).sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
    );
  },

  async listLedger(providerId: string): Promise<LedgerEntry[]> {
    // Fixtures model a single billed provider; the argument is kept so the
    // signature matches the real client exactly.
    return providerId === 'prov-source-1' ? FIXTURE_LEDGER.slice() : [];
  },

  async listMessages(ref: string): Promise<Message[]> {
    return FIXTURE_MESSAGES.filter((m) => m.caseRef === ref).sort(
      (a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt),
    );
  },

  async listNotifications(): Promise<Notification[]> {
    return FIXTURE_NOTIFICATIONS.slice().sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    );
  },

  async getProvider(id: string): Promise<Provider | null> {
    return FIXTURE_PROVIDERS.find((p) => p.id === id) ?? null;
  },

  async listVerificationQueue(): Promise<Provider[]> {
    return FIXTURE_PROVIDERS.filter((p) => p.verification.status === 'pending');
  },

  async listAllCases(status?: CaseStatus): Promise<Case[]> {
    return FIXTURE_CASES.filter((c) => status === undefined || c.status === status).slice();
  },
};
```


- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @mir/web test && pnpm --filter @mir/web typecheck`
Expected: PASS, 10 new tests.

- [ ] **Step 7: Add the two notification dictionary keys**

`notifMessageReceived` and `notifCaseStatusChanged` are referenced by the fixtures. Add both to `ar`, `fr`, and `en` in `apps/web/lib/i18n/dictionary.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/api/ apps/web/lib/i18n/dictionary.ts
git commit -m "Add case API surface and fixture-backed mock implementation"
```

---

### Task 10: Enforce the no-hardcoded-corridor invariant

Brief §4.3 is a rule about code that does not exist yet as much as about code that does. A test is the only thing that keeps it true after this slice ships.

**Files:**
- Create: `apps/web/lib/corridor/no-hardcoded-corridor.test.ts`

**Interfaces:**
- Consumes: nothing — it reads the source tree.
- Produces: nothing importable.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/corridor/no-hardcoded-corridor.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brief §4.3: "No UI copy, routing, or business logic should assume
 * Libya/Tunisia specifically as constants."
 *
 * The corridor registry is the one permitted exception — it is where corridors
 * are configured, so it necessarily names them. Everything else must go
 * through `sideForRole` / `getCorridor`.
 *
 * This test currently documents a known debt: V0's screens predate the
 * corridor layer and still branch on role literals. `ALLOWED` lists them, and
 * the list must only ever shrink. Deleting an entry when a screen is migrated
 * is what turns the rule into a ratchet.
 */

const ROOTS = ['app', 'components'];
const ALLOWED = new Set([
  'app/page.tsx',
  'app/patients/page.tsx',
  'app/patients/new/page.tsx',
  'app/patients/[id]/page.tsx',
  'app/upload/page.tsx',
  'app/appointments/page.tsx',
  'app/appointments/new/page.tsx',
  'app/appointments/[id]/page.tsx',
  'app/doctor/page.tsx',
  'app/doctor/availability/page.tsx',
  'components/AppShell.tsx',
]);

const FORBIDDEN = /\b(libya_doctor|tunisia_doctor|Libya|Tunisia|Libye|Tunisie)\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no hardcoded corridor (§4.3)', () => {
  const offenders = ROOTS.flatMap(walk)
    .map((file) => file.split('\\').join('/'))
    .filter((file) => !ALLOWED.has(file))
    .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')));

  it('has no unlisted screen naming a country or a country-specific role', () => {
    expect(offenders).toEqual([]);
  });

  it('keeps the debt list honest — every allowance still names something', () => {
    for (const allowed of ALLOWED) {
      expect(FORBIDDEN.test(readFileSync(allowed, 'utf8')), `${allowed} is clean; remove it from ALLOWED`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @mir/web test`
Expected: PASS if `ALLOWED` matches reality. If the first assertion fails, a file was missed — add it to `ALLOWED`. If the second fails, a listed file is already clean — delete that entry. Do not weaken `FORBIDDEN` to make either pass.

- [ ] **Step 3: Run the whole verification gate**

Run: `pnpm verify`
Expected: PASS. This runs `check:synthetic`, `typecheck`, `lint`, `boundaries`, `boundaries:verify`, `test`, `build`, and `check:bundle` across the workspace.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/corridor/no-hardcoded-corridor.test.ts
git commit -m "Enforce §4.3 with a ratcheting no-hardcoded-corridor test"
```

---

## What this plan deliberately does not do

- No screens. §5.1–5.8 UI is later slices, each with its own spec built on these contracts.
- No backend modules, migrations, or RLS policies.
- No change to `ROLES`, `LOCALES`, or `infra/keycloak/realm-mir.json`.
- No migration of V0's existing screens off role literals — Task 10 records that debt as a shrinking allowlist instead, so migration happens per screen as each is touched.
