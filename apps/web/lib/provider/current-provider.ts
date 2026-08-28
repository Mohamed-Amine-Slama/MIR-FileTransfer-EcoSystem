'use client';

import { useEffect, useState } from 'react';
import type { CaseSide, Provider, Role } from '@mir/contracts';
import { casesApi } from '../api/mock';
import { sideForRole } from '../corridor/registry';
import { useSession } from '../session/session';

/**
 * Which provider organisation the signed-in user acts for.
 *
 * The identity backend has no notion of an organisation yet — `SessionUser`
 * carries a role, not a provider — so until it does, the role is mapped onto a
 * fixture organisation through the corridor side. This is the single place
 * that mapping lives, so replacing it with a real claim later touches one file
 * rather than every screen.
 *
 * It resolves by SIDE rather than by role name, so it does not become another
 * §4.3 violation while standing in.
 */
const PROVIDER_BY_SIDE: Partial<Record<CaseSide, string>> = {
  source: 'prov-source-1',
  destination: 'prov-dest-1',
};

export function providerIdForRole(role: Role | null): string | null {
  if (role === null) return null;
  const side = sideForRole(role);
  if (side === null) return null;
  return PROVIDER_BY_SIDE[side] ?? null;
}

export interface CurrentProvider {
  loading: boolean;
  providerId: string | null;
  provider: Provider | null;
  side: CaseSide | null;
}

export function useCurrentProvider(): CurrentProvider {
  const { role } = useSession();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);

  const providerId = providerIdForRole(role);
  const side = role === null ? null : sideForRole(role);

  useEffect(() => {
    let cancelled = false;
    if (providerId === null) {
      setProvider(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void casesApi.getProvider(providerId).then((found) => {
      if (!cancelled) {
        setProvider(found);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  return { loading, providerId, provider, side };
}
