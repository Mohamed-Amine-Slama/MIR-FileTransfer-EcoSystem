/**
 * Public API of the `notifications` module (BUILD_SPEC §5.1).
 *
 * The renderer is exported so its guarantees can be reused and tested, but
 * there is no exported "send arbitrary text" function: every message must go
 * through a declared template, which is what keeps clinical detail out of SMS
 * (PHASE 12).
 */
export { render, TEMPLATES, DisallowedTemplateVariableError } from './internal/templates';
export type { TemplateId, TemplateVariables, Channel } from './internal/templates';
export { NotificationsModule } from './notifications.module';
