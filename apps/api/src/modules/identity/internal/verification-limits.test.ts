import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERIFICATION_CODE_TTL_MINUTES, VERIFICATION_MAX_ATTEMPTS } from '@mir/contracts';

/**
 * The attempt cap on an emailed code is enforced in SQL, as a literal inside
 * `identity_verify_email`. It is a literal ON PURPOSE: a limit passed in as a
 * parameter is a limit the caller can raise, and the caller of that function is
 * a public, unauthenticated endpoint.
 *
 * The cost of that choice is a number written down twice — once in the
 * migration and once in the contract the sign-up screen reads. Migration
 * 0009's comment claims the two agree. This is that claim as a test.
 *
 * Six digits is a million possibilities. That is only adequate ALONGSIDE the
 * cap, the expiry, and the `otpRequest` rate-limit budget; if one of these
 * drifts the other two do not compensate, so drift has to be loud.
 */

const MIGRATION = readFileSync(
  join(resolve(__dirname, '..', '..', '..', '..'), 'migrations', '0009_accounts.up.sql'),
  'utf8',
);

describe('verification limits', () => {
  it('caps attempts in SQL at the number the contract advertises', () => {
    const match = /v_max_attempts constant integer := (\d+);/.exec(MIGRATION);
    expect(match, 'the attempt cap literal was not found in 0009_accounts.up.sql').not.toBeNull();
    expect(Number(match?.[1])).toBe(VERIFICATION_MAX_ATTEMPTS);
  });

  it('keeps the cap low enough that guessing six digits stays impractical', () => {
    // Not a style preference: at 5 attempts per issued code, and 3 codes per
    // 15 minutes from the otpRequest budget, a guesser gets 15 tries per
    // quarter-hour against a 1-in-1,000,000 space.
    expect(VERIFICATION_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  it('keeps the code short-lived', () => {
    // Long enough for a slow mail relay, short enough that a code left in an
    // unattended inbox stops working.
    expect(VERIFICATION_CODE_TTL_MINUTES).toBeGreaterThanOrEqual(5);
    expect(VERIFICATION_CODE_TTL_MINUTES).toBeLessThanOrEqual(30);
  });

  it('never stores the code itself — only a digest reaches the database', () => {
    // The columns are `code_hash`, never `code`. If a `code text` column ever
    // appears on that table, a database leak becomes account takeover.
    const table = /CREATE TABLE identity_email_verifications \(([\s\S]*?)\n\);/.exec(MIGRATION);
    expect(table).not.toBeNull();
    expect(table?.[1]).toContain('code_hash');
    expect(table?.[1]).not.toMatch(/^\s+code\s+text/m);
  });
});
