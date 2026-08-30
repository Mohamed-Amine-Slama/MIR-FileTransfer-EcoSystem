'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Organisation } from '../api/endpoints';
import { useSession } from '../session/session';

/**
 * The organisation the signed-in user is seated at — from the REAL API.
 *
 * WHY THIS EXISTS ALONGSIDE `useCurrentProvider`, WHICH LOOKS THE SAME.
 *
 * They answer the same question against different backends, and that is a
 * deliberate seam rather than a duplication to tidy up.
 *
 * `useCurrentProvider` feeds the CASE layer — `/cases`, `/workspace`,
 * `/ledger` — which is served by `lib/api/mock/` because no case endpoints
 * exist yet (see docs/frontend-brief-audit.md). Its provider id must be one the
 * fixtures recognise, so it maps role to a fixture organisation.
 *
 * This hook feeds the ACCOUNT layer — sign-up, verification status, seats,
 * subscription — which is served by real tables from migration 0010. Its id is
 * a real UUID.
 *
 * Pointing the case screens at this hook today would hand them an id the
 * fixtures have never heard of, and every worklist would render empty with no
 * error. The two converge when the case-layer API lands, and `useCurrentProvider`
 * is deleted at that point rather than now.
 */
export function useOrganisation(): {
  organisation: Organisation | null;
  loading: boolean;
  failed: boolean;
  reload: () => Promise<void>;
} {
  const { status } = useSession();
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const { organisation: found } = await api.organisations.mine();
      setOrganisation(found);
      setFailed(false);
    } catch {
      // `organisation: null` is a normal state — an applicant who has not
      // applied yet — so a failure has to be distinguishable from it. A screen
      // that showed "you have not applied" after a network error would send
      // someone to fill the form in a second time.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }
    void reload();
  }, [status, reload]);

  return { organisation, loading, failed, reload };
}
