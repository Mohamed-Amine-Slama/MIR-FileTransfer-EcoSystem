import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';

/**
 * Short-lived signed URLs for direct object access — BUILD_SPEC P8.2.
 *
 * "Issues short-lived (5-15 min) signed URLs for any direct object access."
 *
 * WHY THE SIGNATURE BINDS THE USER, NOT JUST THE OBJECT:
 * a URL that only names an object and an expiry is a bearer token for that
 * object. Forwarded, logged by a proxy, or pasted into a support ticket, it
 * grants anyone the same access for the rest of its life. Binding the subject
 * into the signature means a leaked URL is useless to a different account, and
 * a revoked consent (P5.3) invalidates the next request rather than waiting out
 * a window.
 *
 * WHY THE TTL IS BOUNDED AT BOTH ENDS:
 * the config schema rejects anything outside 300-900 seconds at boot, so a
 * deployment cannot quietly widen the window to hours. This class re-checks,
 * because the value could be computed rather than read.
 */

export interface SignedUrlClaims {
  /** Storage key or DICOMweb path being granted. */
  resource: string;
  /** The user this URL is issued to. */
  userId: string;
  /** Unix seconds. */
  expiresAt: number;
}

export type VerificationResult =
  | { valid: true; claims: SignedUrlClaims }
  | { valid: false; reason: 'expired' | 'bad_signature' | 'malformed' | 'wrong_subject' };

const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;

/**
 * Injection token for the clock.
 *
 * Nest reads constructor parameter types from decorator metadata and cannot
 * see a TypeScript default value, so an undecorated `now: () => number = ...`
 * parameter is treated as a dependency it must resolve — and fails at boot
 * with "can't resolve dependencies ... argument Function at index [1]".
 * Marking it @Optional() with an explicit token means Nest passes undefined in
 * production (so the default applies) while tests can still inject a
 * controllable clock.
 */
export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SignedUrlService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(CLOCK) private readonly now: () => number = () => Date.now(),
  ) {}

  /** Signing key. Derived from the app secret, never reused for anything else. */
  private key(): string {
    // In deployed environments this comes from Secrets Manager alongside the
    // rest of the config (§6). Deriving it from a single dedicated variable
    // keeps URL signing separable from session signing: rotating one must not
    // silently invalidate the other.
    return this.config.SIGNED_URL_SECRET;
  }

  sign(resource: string, userId: string): { token: string; expiresAt: number } {
    const ttl = this.config.SIGNED_URL_TTL_SECONDS;
    if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
      throw new Error(
        `SIGNED_URL_TTL_SECONDS is ${ttl}s, outside the ${MIN_TTL_SECONDS}-${MAX_TTL_SECONDS}s ` +
          'window required by BUILD_SPEC P8.2',
      );
    }

    const expiresAt = Math.floor(this.now() / 1000) + ttl;
    const payload = encodePayload({ resource, userId, expiresAt });
    return { token: `${payload}.${this.mac(payload)}`, expiresAt };
  }

  verify(token: string, expectedUserId: string): VerificationResult {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, reason: 'malformed' };

    const [payload, signature] = parts;
    if (payload === undefined || signature === undefined) {
      return { valid: false, reason: 'malformed' };
    }

    // Constant-time compare. A `===` here leaks signature bytes through timing,
    // which over enough requests is enough to forge one.
    const expected = this.mac(payload);
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'bad_signature' };
    }

    let claims: SignedUrlClaims;
    try {
      claims = decodePayload(payload);
    } catch {
      return { valid: false, reason: 'malformed' };
    }

    // Signature is checked BEFORE expiry so an attacker cannot learn whether a
    // forged payload's expiry was plausible.
    if (claims.expiresAt * 1000 <= this.now()) {
      return { valid: false, reason: 'expired' };
    }

    if (claims.userId !== expectedUserId) {
      return { valid: false, reason: 'wrong_subject' };
    }

    return { valid: true, claims };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key()).update(payload).digest('base64url');
  }
}

function encodePayload(claims: SignedUrlClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

function decodePayload(payload: string): SignedUrlClaims {
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as SignedUrlClaims).resource !== 'string' ||
    typeof (parsed as SignedUrlClaims).userId !== 'string' ||
    typeof (parsed as SignedUrlClaims).expiresAt !== 'number'
  ) {
    throw new Error('malformed claims');
  }
  return parsed as SignedUrlClaims;
}
