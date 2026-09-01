import { describe, expect, it } from 'vitest';
import { NotImplementedException } from '@nestjs/common';
import type { DatabaseService } from '../../../shared/db/database.service';
import type { MailSender } from '../../../shared/mail';
import type { KeycloakAdminClient } from './keycloak-admin.client';
import { RegistrationService } from './registration.service';

/**
 * A registered account has to authenticate AS something.
 *
 * The auth guard reads the role from the TOKEN, and Keycloak puts a role in a
 * token only if the user holds it as a realm role. An account created without
 * one presents a perfectly valid token that resolves to no MIR role at all —
 * every request 401s, including the /verification screen the applicant role
 * exists to reach. The database row saying 'applicant' has no bearing on it.
 */
const INPUT = {
  fullName: 'New Doctor',
  email: 'New.Doctor@example.test',
  password: 'registration-pass-1234',
  phoneE164: '+218911000123',
  locale: 'fr' as const,
};

function fakes(overrides: { createUser?: () => Promise<string | null> } = {}) {
  const calls: string[] = [];
  const keycloak = {
    isConfigured: () => true,
    createUser: overrides.createUser ?? (async () => 'sub-1'),
    assignRealmRole: async (sub: string, role: string) => {
      calls.push(`assignRealmRole:${sub}:${role}`);
    },
    deleteUserQuietly: async (sub: string) => {
      calls.push(`deleteUserQuietly:${sub}`);
    },
  } as unknown as KeycloakAdminClient;

  const db = {
    txAs: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string) => {
          if (sql.includes('identity_register_account')) {
            calls.push('identity_register_account');
            return { rows: [{ identity_register_account: 'sub-1' }] };
          }
          return { rows: [{ identity_issue_email_code: true }] };
        },
      }),
  } as unknown as DatabaseService;

  const mail = { send: async () => { calls.push('mail'); } } as unknown as MailSender;

  return { service: new RegistrationService(db, keycloak, mail), calls };
}

describe('RegistrationService.register (P5.1)', () => {
  it('grants the applicant realm role, so the account can authenticate', async () => {
    const { service, calls } = fakes();
    await service.register(INPUT);
    expect(calls).toContain('assignRealmRole:sub-1:applicant');
  });

  it('grants it before writing the row, so a failure there rolls the user back', async () => {
    const { service, calls } = fakes();
    await service.register(INPUT);
    expect(calls).toContain('assignRealmRole:sub-1:applicant');
    expect(calls).toContain('identity_register_account');
    expect(calls.indexOf('assignRealmRole:sub-1:applicant')).toBeLessThan(
      calls.indexOf('identity_register_account'),
    );
  });

  it('still refuses when no admin credential is configured', async () => {
    const { service } = fakes();
    (service as unknown as { keycloak: { isConfigured: () => boolean } }).keycloak.isConfigured =
      () => false;
    await expect(service.register(INPUT)).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('assigns nothing when the address was already taken upstream', async () => {
    const { service, calls } = fakes({ createUser: async () => null });
    await service.register(INPUT);
    expect(calls).toEqual([]);
  });
});
