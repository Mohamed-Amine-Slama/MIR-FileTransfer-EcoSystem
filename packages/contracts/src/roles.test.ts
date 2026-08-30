import { describe, expect, it } from 'vitest';
import { CLINICAL_ROLES, isClinicalRole, LOCALE_DIRECTION, ROLES, roleSchema } from './roles';

describe('roles', () => {
  it('accepts the four P3.1 roles plus applicant, and rejects anything else', () => {
    expect(roleSchema.parse('libya_doctor')).toBe('libya_doctor');
    expect(roleSchema.parse('tunisia_doctor')).toBe('tunisia_doctor');
    expect(roleSchema.parse('patient')).toBe('patient');
    expect(roleSchema.parse('admin')).toBe('admin');
    expect(roleSchema.parse('applicant')).toBe('applicant');
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

  it('keeps applicant last, so the four P3.1 roles keep their historical order', () => {
    expect(ROLES[ROLES.length - 1]).toBe('applicant');
  });

  it('marks Arabic as RTL (DECISION D4)', () => {
    expect(LOCALE_DIRECTION.ar).toBe('rtl');
    expect(LOCALE_DIRECTION.fr).toBe('ltr');
  });
});
