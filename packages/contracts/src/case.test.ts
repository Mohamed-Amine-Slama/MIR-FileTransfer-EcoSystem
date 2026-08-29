import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  canTransition,
  canViewCase,
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

describe('case audience (§5.4 P0, §4.4)', () => {
  const item = caseSchema.parse({
    ref: 'MIR-2026-0417',
    corridorId: 'ly-tn',
    status: 'in_progress',
    submittedByProviderId: 'prov-a',
    matchedProviderId: 'prov-b',
    patientId: 'pat-1',
    studyIds: ['study-1'],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-06T11:30:00.000Z',
    intake: {},
  });

  it('lets the referring provider see their own case', () => {
    expect(canViewCase(item, { kind: 'provider', providerId: 'prov-a' })).toBe(true);
  });

  it('lets the matched provider see the case they were matched to', () => {
    expect(canViewCase(item, { kind: 'provider', providerId: 'prov-b' })).toBe(true);
  });

  it('refuses a provider who is not a party, however they reached the URL', () => {
    // §5.4 P0: only authorised parties for a given case see its files. A case
    // reference is short and guessable, so knowing one must not grant access.
    expect(canViewCase(item, { kind: 'provider', providerId: 'prov-c' })).toBe(false);
  });

  it('lets ops see any case, because that is what oversight means (§5.8)', () => {
    expect(canViewCase(item, { kind: 'ops' })).toBe(true);
  });

  it('does not treat an unmatched case as visible to everyone', () => {
    const unmatched = caseSchema.parse({ ...item, matchedProviderId: undefined });
    expect(canViewCase(unmatched, { kind: 'provider', providerId: 'prov-b' })).toBe(false);
    expect(canViewCase(unmatched, { kind: 'provider', providerId: 'prov-a' })).toBe(true);
  });
});
