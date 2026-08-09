import { describe, expect, it } from 'vitest';
import { CLINICAL_ROLES, isClinicalRole, LOCALE_DIRECTION, roleSchema } from './roles';

describe('roles', () => {
  it('accepts the four roles from P3.1 and rejects anything else', () => {
    expect(roleSchema.parse('libya_doctor')).toBe('libya_doctor');
    expect(roleSchema.parse('tunisia_doctor')).toBe('tunisia_doctor');
    expect(roleSchema.parse('patient')).toBe('patient');
    expect(roleSchema.parse('admin')).toBe('admin');
    expect(() => roleSchema.parse('superuser')).toThrow();
  });

  it('treats every role except patient as clinical for MFA purposes (P4.3)', () => {
    expect(isClinicalRole('libya_doctor')).toBe(true);
    expect(isClinicalRole('tunisia_doctor')).toBe(true);
    expect(isClinicalRole('admin')).toBe(true);
    expect(isClinicalRole('patient')).toBe(false);
    expect(CLINICAL_ROLES).toHaveLength(3);
  });

  it('marks Arabic as RTL (DECISION D4)', () => {
    expect(LOCALE_DIRECTION.ar).toBe('rtl');
    expect(LOCALE_DIRECTION.fr).toBe('ltr');
  });
});
