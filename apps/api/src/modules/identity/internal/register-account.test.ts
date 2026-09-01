import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDatabase, truncateAll, type Harness } from '../../../shared/db/testing/rls-harness';

/**
 * `identity_users.id` IS the Keycloak subject, everywhere in this schema.
 *
 * `users_self` is `(id = app_current_user_id())` and app_current_user_id() is
 * set from the token's `sub` — so a row whose id is anything else is invisible
 * to the person it belongs to, under every policy at once. Registration let the
 * column default to uuid_generate_v7() and produced exactly that row: a valid
 * account that 404s on /auth/me and matches no self policy.
 */
describe('identity_register_account (P5.1)', () => {
  let h: Harness;

  beforeEach(async () => {
    h ??= await setupTestDatabase();
    await truncateAll(h.owner);
  });

  afterAll(async () => {
    await h?.close();
  });

  const SUB = '3f1c8b2e-1d4a-4c9e-9f11-52b7a0c4d8e6';

  it('keys the new row by the Keycloak subject, not a generated id', async () => {
    const created = await h.owner.query<{ identity_register_account: string }>(
      'SELECT identity_register_account($1, $2, $3, $4, $5)',
      [SUB, 'New.Doctor@example.test', 'New Doctor', '+218911000123', 'fr'],
    );
    expect(created.rows[0]?.identity_register_account).toBe(SUB);

    const row = await h.owner.query<{ id: string; keycloak_sub: string; role: string }>(
      'SELECT id, keycloak_sub, role FROM identity_users WHERE email = $1',
      ['new.doctor@example.test'],
    );
    expect(row.rows[0]?.id).toBe(SUB);
    expect(row.rows[0]?.keycloak_sub).toBe(SUB);
    // Still not a parameter, and still not clinical.
    expect(row.rows[0]?.role).toBe('applicant');
  });

  it('attaches the preferences row to that same id', async () => {
    await h.owner.query('SELECT identity_register_account($1, $2, $3, $4, $5)', [
      SUB,
      'prefs@example.test',
      'Prefs Person',
      '+218911000124',
      'ar',
    ]);
    const prefs = await h.owner.query<{ user_id: string }>(
      'SELECT user_id FROM identity_user_preferences WHERE user_id = $1',
      [SUB],
    );
    expect(prefs.rowCount).toBe(1);
  });

  it('still answers NULL for an address that is already registered', async () => {
    await h.owner.query('SELECT identity_register_account($1, $2, $3, $4, $5)', [
      SUB,
      'dupe@example.test',
      'First Person',
      '+218911000125',
      'fr',
    ]);
    const second = await h.owner.query<{ identity_register_account: string | null }>(
      'SELECT identity_register_account($1, $2, $3, $4, $5)',
      [
        'a0b1c2d3-e4f5-4678-9abc-def012345678',
        'dupe@example.test',
        'Second Person',
        '+218911000126',
        'fr',
      ],
    );
    expect(second.rows[0]?.identity_register_account).toBeNull();
  });
});
