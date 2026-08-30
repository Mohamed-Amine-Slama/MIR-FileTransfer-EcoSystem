import { describe, expect, it } from 'vitest';
import { hasSeatAvailable, invitationSchema, seatRoleSchema } from './membership';

describe('seat roles', () => {
  it('has exactly two levels, so an unused permission tier cannot rot', () => {
    expect(seatRoleSchema.options).toEqual(['owner', 'member']);
  });
});

describe('invitations', () => {
  const valid = {
    id: '00000000-0000-4000-8000-000000000001',
    organisationId: 'org-1',
    email: 'new@clinic.test',
    seatRole: 'member' as const,
    invitedBy: '00000000-0000-4000-8000-000000000002',
    expiresAt: '2026-09-13T00:00:00.000Z',
    createdAt: '2026-08-30T00:00:00.000Z',
  };

  /**
   * The token is a bearer credential: whoever holds it joins the organisation
   * and can then read its cases. Only its hash is stored, and neither reaches a
   * response. Zod strips unknown keys, so a careless service that spreads the
   * database row into the response drops it here rather than publishing it.
   */
  it('carries neither the token nor its hash', () => {
    const parsed = invitationSchema.parse({ ...valid, token: 'abc', tokenHash: 'def' });
    expect(parsed).not.toHaveProperty('token');
    expect(parsed).not.toHaveProperty('tokenHash');
  });
});

describe('seat availability', () => {
  it('counts outstanding invitations, not only accepted members', () => {
    // Ten seats, three filled, seven invitations already sent: full. Counting
    // members alone would let the owner send an eighth and have the person who
    // accepts it be the one refused.
    expect(hasSeatAvailable(10, 3, 7)).toBe(false);
    expect(hasSeatAvailable(10, 3, 6)).toBe(true);
  });

  it('refuses when the organisation is already at its limit', () => {
    expect(hasSeatAvailable(1, 1, 0)).toBe(false);
    expect(hasSeatAvailable(1, 0, 0)).toBe(true);
  });
});
