/**
 * Public API of the `identity` module (BUILD_SPEC §5.1).
 *
 * Everything another module is allowed to touch is re-exported here. Anything
 * under `internal/` is private and importing it from outside this directory
 * fails the build (P1.4).
 *
 * Cross-module calls go through this file or through domain events (§5.2).
 * There is no third option — in particular, no module may query another
 * module's tables directly.
 */
export { IdentityService } from './internal/identity.service';
export type { CurrentUser } from './internal/identity.service';
export { IdentityModule } from './identity.module';
