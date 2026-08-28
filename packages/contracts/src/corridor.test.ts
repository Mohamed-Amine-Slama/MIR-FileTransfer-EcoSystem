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
    expect(corridorEndpointFor(corridor, 'source')?.licensingBodyKey).toBe(
      'licensingBodyLyMedicalSyndicate',
    );
    expect(corridorEndpointFor(corridor, 'destination')?.country).toBe('TN');
    expect(corridorEndpointFor(corridor, 'ops')).toBeNull();
  });

  it('carries dictionary keys rather than translated copy, so §4.2 still holds', () => {
    for (const field of corridor.intakeFields) {
      expect(field.labelKey).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
  });
});
