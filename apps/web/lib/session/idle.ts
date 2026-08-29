/**
 * Idle session policy — brief §4.4.
 *
 * "Session timeout / re-authentication for sensitive actions (viewing imaging,
 * downloading files) should be visible and predictable to the user, not
 * silent."
 *
 * The whole of that requirement is about the USER'S experience of the timeout,
 * not about the timeout itself: the access token's real lifetime is decided by
 * Keycloak and enforced by the API. What the frontend owes is a clinic
 * receptionist who steps away from a shared machine knowing that it will lock,
 * roughly when, and how to stop it — instead of losing a half-typed referral to
 * a silent 401.
 *
 * Pure functions, so the policy is testable without a clock or a component.
 */

/** Fifteen minutes: long enough to read a study, short enough for a shared PC. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Two minutes' notice — enough to finish a sentence and click. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;

export type IdleState = 'active' | 'warning' | 'expired';

export function remainingMs(lastActivityAt: number, now: number): number {
  return Math.max(0, lastActivityAt + IDLE_TIMEOUT_MS - now);
}

export function idleState(lastActivityAt: number, now: number): IdleState {
  const left = remainingMs(lastActivityAt, now);
  if (left <= 0) return 'expired';
  return left <= IDLE_WARNING_MS ? 'warning' : 'active';
}

/**
 * `m:ss`, with Latin digits on purpose.
 *
 * A countdown is scanned, not read, and the same glyphs in every locale means
 * a French and an Arabic user describing the screen over the phone are
 * describing the same thing.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
