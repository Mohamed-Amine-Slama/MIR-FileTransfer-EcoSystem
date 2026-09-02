import { describe, expect, it } from 'vitest';
import {
  CLINICAL_ROLES,
  isClinicalRole,
  LOCALE_DIRECTION,
  requiresSecondFactor,
  ROLES,
  roleSchema,
  SECOND_FACTOR_ROLES,
} from './roles';

describe('roles', () => {
  it('accepts the four P3.1 roles plus applicant and assistant, and rejects anything else', () => {
    expect(roleSchema.parse('libya_doctor')).toBe('libya_doctor');
    expect(roleSchema.parse('tunisia_doctor')).toBe('tunisia_doctor');
    expect(roleSchema.parse('patient')).toBe('patient');
    expect(roleSchema.parse('admin')).toBe('admin');
    expect(roleSchema.parse('applicant')).toBe('applicant');
    expect(roleSchema.parse('assistant')).toBe('assistant');
    expect(() => roleSchema.parse('superuser')).toThrow();
  });

  it('treats the three data-bearing roles as clinical for MFA purposes (P4.3)', () => {
    expect(isClinicalRole('libya_doctor')).toBe(true);
    expect(isClinicalRole('tunisia_doctor')).toBe(true);
    expect(isClinicalRole('admin')).toBe(true);
    expect(isClinicalRole('patient')).toBe(false);
    expect(CLINICAL_ROLES).toHaveLength(3);
  });

  it('does not require a second factor of an applicant, who can reach no data', () => {
    // If this ever flips, check WHY before changing it: an applicant that can
    // read something is a role that has grown an access path it was created
    // not to have.
    expect(isClinicalRole('applicant')).toBe(false);
  });

  it('keeps the four P3.1 roles in their historical order, with later ones appended', () => {
    // The invariant is about the FIRST four, not about which role happens to
    // be last. New roles are appended, so this stays true as the list grows —
    // the previous spelling asserted `applicant` was last and had to be
    // rewritten the first time a role was added after it.
    expect(ROLES.slice(0, 4)).toEqual(['libya_doctor', 'tunisia_doctor', 'patient', 'admin']);
    expect(ROLES.indexOf('applicant')).toBe(4);
  });

  /**
   * An assistant is NOT clinical and DOES need a second factor. Keeping the two
   * questions apart is the whole reason `SECOND_FACTOR_ROLES` exists: widening
   * `CLINICAL_ROLES` to get the login check would have quietly proposed a
   * receptionist for imaging access too, since the imaging policies and the
   * corridor grant are both written against the clinical set.
   */
  it('requires a second factor of an assistant without making them clinical', () => {
    expect(isClinicalRole('assistant')).toBe(false);
    expect(CLINICAL_ROLES).not.toContain('assistant');

    expect(requiresSecondFactor('assistant')).toBe(true);
    expect(requiresSecondFactor('libya_doctor')).toBe(true);
    expect(requiresSecondFactor('patient')).toBe(false);
    expect(requiresSecondFactor('applicant')).toBe(false);
    expect(SECOND_FACTOR_ROLES).toHaveLength(CLINICAL_ROLES.length + 1);
  });

  it('marks Arabic as RTL (DECISION D4)', () => {
    expect(LOCALE_DIRECTION.ar).toBe('rtl');
    expect(LOCALE_DIRECTION.fr).toBe('ltr');
  });
});
