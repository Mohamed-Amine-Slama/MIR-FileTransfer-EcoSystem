/**
 * Public API of the `audit` module (BUILD_SPEC §5.1).
 *
 * Only the write path is exported. There is deliberately no exported reader:
 * audit rows are readable by admins through their own controller and by
 * nobody else, and exposing a query helper here would invite another module
 * to build a feature on top of the log.
 *
 * Note what is NOT here: no update, no delete, no redaction helper.
 */
export { AuditService, type AuditRecord } from './internal/audit.service';
export { AuditModule } from './audit.module';
