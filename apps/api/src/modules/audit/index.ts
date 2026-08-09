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

/**
 * The bus integration point. Exported because attaching the audit log to an
 * event bus is a legitimate public capability of this module — it is what
 * AuditModule does in production, and what a cross-module integration test
 * needs in order to assert that an action produced an audit row.
 *
 * Re-exporting through this index is the sanctioned way to share it: callers
 * import `modules/audit`, never `modules/audit/internal/...` (§5.1 rule 2).
 */
export { AuditSubscriber, AUDITED_EVENTS } from './internal/audit.subscriber';
export { AuditModule } from './audit.module';
