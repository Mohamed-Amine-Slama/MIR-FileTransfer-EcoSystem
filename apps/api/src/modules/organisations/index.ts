/**
 * Public API of the `organisations` module (brief §3, §5.5).
 *
 * Anything under `internal/` is private; importing it from outside this
 * directory fails the dependency-cruiser boundary check (P1.4).
 */
export { OrganisationsService } from './internal/organisations.service';
export type { MemberRow, OrganisationRow } from './internal/organisations.service';
export { OrganisationsModule } from './organisations.module';
