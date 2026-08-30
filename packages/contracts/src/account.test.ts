import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  PASSWORD_MIN_LENGTH,
  phoneE164Schema,
  registrationSchema,
  themeSchema,
  userPreferencesSchema,
  verificationCodeSchema,
} from './account';

describe('phone numbers', () => {
  it('accepts E.164 and rejects the shapes people actually type', () => {
    expect(phoneE164Schema.parse('+218911234567')).toBe('+218911234567');
    expect(() => phoneE164Schema.parse('0911234567')).toThrow();
    expect(() => phoneE164Schema.parse('+218 91 123 4567')).toThrow();
    expect(() => phoneE164Schema.parse('+0911234567')).toThrow();
  });
});

describe('verification codes', () => {
  it('is exactly six digits — not five, not seven, not a code with a space', () => {
    expect(verificationCodeSchema.parse('481920')).toBe('481920');
    expect(() => verificationCodeSchema.parse('48192')).toThrow();
    expect(() => verificationCodeSchema.parse('4819201')).toThrow();
    expect(() => verificationCodeSchema.parse('481 920')).toThrow();
  });
});

describe('registration', () => {
  const valid = {
    fullName: 'Dr Amal Ben Salah',
    email: 'amal@clinic.test',
    password: 'a-sufficiently-long-password',
    phoneE164: '+218911234567',
    locale: 'ar' as const,
  };

  it('accepts a complete application', () => {
    expect(registrationSchema.parse(valid).email).toBe('amal@clinic.test');
  });

  /**
   * THE LOAD-BEARING ASSERTION IN THIS FILE.
   *
   * Registration is a public, unauthenticated endpoint. If a `role` ever
   * survives parsing, a stranger can assert `libya_doctor` about themselves
   * over the internet and the only thing standing between them and a clinical
   * role is that nobody noticed. Zod strips unknown keys, so this holds today;
   * the test is what stops someone "helpfully" adding the field later.
   */
  it('cannot carry a role — the clinical role is granted on approval, never claimed', () => {
    const parsed = registrationSchema.parse({ ...valid, role: 'libya_doctor' });
    expect(parsed).not.toHaveProperty('role');
  });

  it('refuses a password shorter than the realm policy', () => {
    expect(() => registrationSchema.parse({ ...valid, password: 'short' })).toThrow();
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });
});

describe('preferences', () => {
  it('treats system as a stored value, not the absence of a choice', () => {
    expect(themeSchema.parse('system')).toBe('system');
    expect(DEFAULT_PREFERENCES.theme).toBe('system');
  });

  it('ships a default that is itself valid', () => {
    expect(() => userPreferencesSchema.parse(DEFAULT_PREFERENCES)).not.toThrow();
  });

  /**
   * §5.6 P0 makes case-level notification a requirement, and the in-app centre
   * is where a provider finds a status change they must act on. If it becomes
   * togglable, someone can silently opt out of the thing the platform exists
   * to tell them.
   */
  it('offers no switch for in-app notifications', () => {
    expect(Object.keys(DEFAULT_PREFERENCES.notify).sort()).toEqual(['email', 'sms']);
  });
});
