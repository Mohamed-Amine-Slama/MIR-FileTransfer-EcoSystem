import { describe, expect, it } from 'vitest';
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  formatRemaining,
  idleState,
  remainingMs,
} from './idle';

const START = 1_700_000_000_000;

describe('idle session state (§4.4)', () => {
  it('is active while there is more than the warning window left', () => {
    expect(idleState(START, START)).toBe('active');
    expect(idleState(START, START + IDLE_TIMEOUT_MS - IDLE_WARNING_MS - 1)).toBe('active');
  });

  it('warns before expiry rather than at it — the point is to be predictable', () => {
    // §4.4: "visible and predictable to the user, not silent". A warning that
    // arrives at the moment of logout is not a warning.
    expect(idleState(START, START + IDLE_TIMEOUT_MS - IDLE_WARNING_MS)).toBe('warning');
    expect(idleState(START, START + IDLE_TIMEOUT_MS - 1)).toBe('warning');
  });

  it('expires exactly at the timeout, not a tick later', () => {
    expect(idleState(START, START + IDLE_TIMEOUT_MS)).toBe('expired');
    expect(idleState(START, START + IDLE_TIMEOUT_MS + 60_000)).toBe('expired');
  });

  it('warns for a useful length of time', () => {
    // A warning shorter than it takes to read it is decoration.
    expect(IDLE_WARNING_MS).toBeGreaterThanOrEqual(60_000);
    expect(IDLE_WARNING_MS).toBeLessThan(IDLE_TIMEOUT_MS);
  });

  it('never reports negative time remaining', () => {
    expect(remainingMs(START, START + IDLE_TIMEOUT_MS + 10_000)).toBe(0);
  });

  it('counts down from the last activity, so using the app keeps it alive', () => {
    const later = START + IDLE_TIMEOUT_MS - 1000;
    expect(idleState(later, later)).toBe('active');
  });
});

describe('remaining time is readable at a glance', () => {
  it('formats as minutes and seconds', () => {
    expect(formatRemaining(125_000)).toBe('2:05');
    expect(formatRemaining(60_000)).toBe('1:00');
    expect(formatRemaining(9_000)).toBe('0:09');
  });

  it('floors at zero rather than showing a negative clock', () => {
    expect(formatRemaining(-5_000)).toBe('0:00');
  });

  it('uses Latin digits and a colon, which read the same in every locale', () => {
    // Deliberately not Intl-formatted: a countdown rendered with Arabic-Indic
    // digits beside a Latin case reference is harder to scan, not easier.
    expect(formatRemaining(125_000)).toMatch(/^\d+:\d{2}$/);
  });
});
