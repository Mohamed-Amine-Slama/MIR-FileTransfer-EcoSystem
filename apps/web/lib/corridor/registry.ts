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
 * on the first render in development, not on the one screen that happens to
 * read the field nobody tested.
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
