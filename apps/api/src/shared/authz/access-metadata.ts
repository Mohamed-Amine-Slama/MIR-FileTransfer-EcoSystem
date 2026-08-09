import { SetMetadata } from '@nestjs/common';
import type { Role } from '@mir/contracts';

/**
 * Explicit access declaration for every route (BUILD_SPEC P1.5, §6).
 *
 * The rule: an endpoint can never ship without someone having made an access
 * decision about it. Not "we forgot to add a guard" — the build refuses.
 *
 * This is a declaration, not the enforcement mechanism. Enforcement is the
 * guard added in P4.2, plus PostgreSQL row-level security (ADR-6). Two
 * independent layers: a bug in one must not expose data.
 */

export const REQUIRES_ROLE_KEY = 'mir:requires_role';
export const PUBLIC_ENDPOINT_KEY = 'mir:public_endpoint';

/**
 * Restrict a route (or a whole controller) to the listed roles.
 *
 * Listing a role here grants *reachability*, never data visibility. A
 * `tunisia_doctor` may reach the study endpoint; whether any rows come back is
 * decided by RLS, which does not trust this decorator.
 */
export const RequiresRole = (...roles: [Role, ...Role[]]) =>
  SetMetadata(REQUIRES_ROLE_KEY, roles);

/**
 * Mark a route as intentionally unauthenticated.
 *
 * Use sparingly and never on anything that touches patient data. Every use is
 * a deliberate, reviewable statement that this route is safe to expose to the
 * internet — which is exactly why it must be typed out rather than defaulted.
 */
export const PublicEndpoint = () => SetMetadata(PUBLIC_ENDPOINT_KEY, true);
