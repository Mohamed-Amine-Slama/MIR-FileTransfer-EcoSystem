import { describe, expect, it } from 'vitest';
import {
  evaluatePhoneMatch,
  isValidE164,
  normalisePhoneForLookup,
  preserveEnteredName,
  type PatientCandidate,
} from './patient-matching';

const candidate = (over: Partial<PatientCandidate> = {}): PatientCandidate => ({
  id: '018f8e6a-0000-7000-8000-000000000001',
  fullName: 'محمد علي',
  dateOfBirth: '1985-06-15',
  phoneE164: '+218912345678',
  sex: 'M',
  ...over,
});

describe('P3.3 patient identity matching', () => {
  it('returns no_match when the phone is unknown', () => {
    expect(evaluatePhoneMatch([])).toEqual({ kind: 'no_match' });
  });

  it('requires explicit confirmation on a phone match — never a silent merge', () => {
    const existing = candidate();
    const result = evaluatePhoneMatch([existing]);

    expect(result.kind).toBe('confirmation_required');
    // The doctor must be shown name + DOB and confirm it is the same person.
    if (result.kind === 'confirmation_required') {
      expect(result.candidates[0]?.fullName).toBe('محمد علي');
      expect(result.candidates[0]?.dateOfBirth).toBe('1985-06-15');
    }
  });

  it('surfaces every candidate on a shared handset, not just the first', () => {
    // A family sharing one phone is common. Auto-selecting the first match
    // would attach a child's scan to their parent's record.
    const result = evaluatePhoneMatch([
      candidate({ id: 'a', fullName: 'محمد علي' }),
      candidate({ id: 'b', fullName: 'فاطمة علي', dateOfBirth: '2010-02-02' }),
    ]);
    expect(result.kind).toBe('confirmation_required');
    if (result.kind === 'confirmation_required') {
      expect(result.candidates).toHaveLength(2);
    }
  });

  describe('no name-based matching exists', () => {
    it('identical names with different phones are two separate people', () => {
      // Same name, different phone -> the phone lookup returns nothing, so
      // there is no candidate to confuse them with. This is the property the
      // spec demands: two records, not one merged record.
      expect(evaluatePhoneMatch([])).toEqual({ kind: 'no_match' });
    });

    it('preserves the doctor transliteration verbatim', () => {
      // These are the same person written four ways. We store what was typed;
      // we do not normalise them toward each other, because doing so is the
      // first step toward merging them.
      expect(preserveEnteredName('Mohamed Ali')).toBe('Mohamed Ali');
      expect(preserveEnteredName('Mohammed  Ali')).toBe('Mohammed Ali');
      expect(preserveEnteredName('  Muhammad Ali ')).toBe('Muhammad Ali');
      expect(preserveEnteredName('محمد علي')).toBe('محمد علي');
    });

    it('does not case-fold or strip diacritics', () => {
      expect(preserveEnteredName('MOHAMED ali')).toBe('MOHAMED ali');
      expect(preserveEnteredName('Béchir')).toBe('Béchir');
    });
  });

  describe('phone handling', () => {
    it('accepts valid E.164 and rejects the near-misses', () => {
      expect(isValidE164('+218912345678')).toBe(true); // Libya
      expect(isValidE164('+21620123456')).toBe(true); // Tunisia
      expect(isValidE164('0912345678')).toBe(false); // no country code
      expect(isValidE164('+0912345678')).toBe(false); // leading zero CC
      expect(isValidE164('+218 91 234 5678')).toBe(false); // unnormalised
      expect(isValidE164('')).toBe(false);
    });

    it('strips formatting and converts the 00 prefix', () => {
      expect(normalisePhoneForLookup(' +218 91-234.5678 ')).toBe('+218912345678');
      expect(normalisePhoneForLookup('00218912345678')).toBe('+218912345678');
      expect(normalisePhoneForLookup('(+216) 20 123 456')).toBe('+21620123456');
    });

    it('never guesses a missing country code', () => {
      // A bare national number stays bare and fails E.164 validation, forcing
      // the caller to ask. Inferring "+218" here would match a Tunisian
      // patient whose number shares the trailing digits.
      const out = normalisePhoneForLookup('912345678');
      expect(out).toBe('912345678');
      expect(isValidE164(out)).toBe(false);
    });
  });
});
