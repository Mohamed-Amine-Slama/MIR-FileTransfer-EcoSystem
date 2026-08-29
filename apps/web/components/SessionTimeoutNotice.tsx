'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useT } from '../lib/i18n/provider';
import {
  IDLE_WARNING_MS,
  formatRemaining,
  idleState,
  remainingMs,
} from '../lib/session/idle';
import { useSession } from '../lib/session/session';
import { Alert, Button } from './ui';

/**
 * The visible half of the §4.4 idle policy.
 *
 * WHY A BANNER AND NOT A MODAL. A modal over a study a radiologist is mid-way
 * through reading is an interruption at the worst possible moment, and the one
 * thing a clinician does reflexively with a modal is dismiss it. A banner that
 * counts down is visible without stealing focus, and the countdown is what
 * makes the timeout *predictable* rather than merely announced.
 *
 * Activity resets the clock. The listeners are passive and capture-phase so
 * they cannot interfere with anything the page does with the same events.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/** One second: the countdown has to move, or it reads as frozen. */
const TICK_MS = 1000;

export function SessionTimeoutNotice(): React.JSX.Element | null {
  const t = useT();
  const { status, signOut } = useSession();
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const touch = useCallback(() => {
    setLastActivityAt(Date.now());
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, touch, { passive: true, capture: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, touch, { capture: true });
      }
    };
  }, [status, touch]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [status]);

  const state = status === 'authenticated' ? idleState(lastActivityAt, now) : 'active';

  // Signing out is a side effect, so it belongs in an effect rather than in
  // render — a state transition computed during render must not mutate the
  // session other components are reading in the same pass.
  useEffect(() => {
    if (state === 'expired') signOut();
  }, [state, signOut]);

  if (status !== 'authenticated' || state !== 'warning') return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6" data-testid="session-warning">
      <Alert tone="warning">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{t.sessionExpiringTitle}</p>
            <p className="mt-0.5">{t.sessionExpiringBody}</p>
            <p className="mt-1 flex items-center gap-1.5 font-medium">
              <Clock className="size-4" aria-hidden="true" />
              {t.sessionRemaining}{' '}
              {/* aria-live so the countdown is announced, but politely: it must
                  not interrupt a screen reader mid-sentence every second. */}
              <span
                aria-live="polite"
                data-testid="session-remaining"
                className="font-mono tabular-nums"
              >
                {formatRemaining(remainingMs(lastActivityAt, now))}
              </span>
            </p>
          </div>
          <Button variant="primary" data-testid="session-extend" onClick={touch}>
            {t.sessionExtend}
          </Button>
        </div>
      </Alert>
    </div>
  );
}

/** Exported for the layout to reason about spacing without importing the constant twice. */
export { IDLE_WARNING_MS };
