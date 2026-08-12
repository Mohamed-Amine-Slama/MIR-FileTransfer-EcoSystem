'use client';

import { useEffect, useState } from 'react';
import { api, type AuditEvent } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { Alert, Badge, EmptyState, PageHeader, Spinner } from '../../../components/ui';

/**
 * Audit log viewer — BUILD_SPEC P6.
 *
 * READ-ONLY, AND THERE IS NO DELETE CONTROL ANYWHERE ON THIS PAGE. The audit
 * table is append-only at the database level (the application role holds no
 * DELETE grant at all), so a delete button could not work even if someone
 * added one. Not offering it keeps the UI honest about that.
 *
 * DENIED events are shown alongside allowed ones and are the more interesting
 * half: a burst of denials is what an account probing for other doctors'
 * patients looks like.
 */
export default function AuditPage(): React.JSX.Element {
  return (
    <RoleGate allow={['admin']}>
      <AuditLog />
    </RoleGate>
  );
}

function AuditLog(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { events: rows } = await api.audit.recent();
        setEvents(rows);
      } catch {
        setError(t.genericError);
        setEvents([]);
      }
    })();
  }, [t]);

  return (
    <main className="page--wide stack">
      <PageHeader title={t.auditTitle} description={t.auditDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {events === null ? (
        <Spinner label={t.loading} />
      ) : events.length === 0 ? (
        <EmptyState testId="audit-empty">{t.auditEmpty}</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }} data-testid="audit-table">
            <thead>
              <tr>
                <th style={cell}>{t.auditWhen}</th>
                <th style={cell}>{t.auditActor}</th>
                <th style={cell}>{t.auditAction}</th>
                <th style={cell}>{t.auditOutcome}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} data-testid="audit-row" data-outcome={e.outcome}>
                  <td style={cell}>{formatDate(e.occurredAt)}</td>
                  <td style={cell} className="small muted">
                    {e.actorUserId ?? '—'}
                  </td>
                  <td style={cell} className="small">
                    {e.action}
                  </td>
                  <td style={cell}>
                    <Badge tone={e.outcome === 'denied' ? 'danger' : 'success'}>{e.outcome}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

// text-align: start, not left — the table must flip under RTL like everything
// else (D4).
const cell: React.CSSProperties = {
  textAlign: 'start',
  padding: '0.4rem 0.6rem',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
};
