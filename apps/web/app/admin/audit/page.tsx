'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type AuditEvent } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import {
  Alert,
  Badge,
  EmptyState,
  Field,
  Input,
  Main,
  PageHeader,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui';

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
 *
 * Filters are CLIENT-SIDE over the fetched window — the endpoint supports
 * only a limit — and the caption says how many events that window holds, so
 * "no rows after filtering" is never mistaken for "no events happened".
 */
export default function AuditPage(): React.JSX.Element {
  return (
    <RoleGate allow={['admin']}>
      <AuditLog />
    </RoleGate>
  );
}

type OutcomeFilter = 'all' | 'allowed' | 'denied';

function AuditLog(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [actionQuery, setActionQuery] = useState('');

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

  const filtered = useMemo(() => {
    if (events === null) return null;
    const query = actionQuery.trim().toLowerCase();
    return events.filter(
      (e) =>
        (outcome === 'all' || e.outcome === outcome) &&
        (query === '' || e.action.toLowerCase().includes(query)),
    );
  }, [events, outcome, actionQuery]);

  return (
    <Main wide>
      <PageHeader title={t.auditTitle} description={t.auditDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {events === null || filtered === null ? (
        <Spinner label={t.loading} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label={t.auditOutcome}>
                <Select
                  data-testid="audit-filter-outcome"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}
                >
                  <option value="all">{t.auditFilterAll}</option>
                  <option value="allowed">{t.auditAllowed}</option>
                  <option value="denied">{t.auditDenied}</option>
                </Select>
              </Field>
            </div>
            <div className="min-w-56 flex-1 sm:max-w-sm">
              <Field label={t.auditAction}>
                <Input
                  data-testid="audit-filter-action"
                  value={actionQuery}
                  placeholder={t.auditFilterActionPlaceholder}
                  onChange={(e) => setActionQuery(e.target.value)}
                />
              </Field>
            </div>
            <p className="ms-auto pb-2.5 text-sm tabular-nums text-muted-foreground">
              {t.auditShowingRecent}: {filtered.length} / {events.length}
            </p>
          </div>

          {events.length === 0 ? (
            <EmptyState testId="audit-empty">{t.auditEmpty}</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState>{t.none}</EmptyState>
          ) : (
            <Table data-testid="audit-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.auditWhen}</TableHead>
                  <TableHead>{t.auditActor}</TableHead>
                  <TableHead>{t.auditAction}</TableHead>
                  <TableHead>{t.auditOutcome}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow
                    key={e.id}
                    data-testid="audit-row"
                    data-outcome={e.outcome}
                    className={e.outcome === 'denied' ? 'bg-danger-surface/40' : undefined}
                  >
                    <TableCell className="whitespace-nowrap">{formatDate(e.occurredAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                      {e.actorUserId ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs" dir="ltr">
                      {e.action}
                    </TableCell>
                    <TableCell>
                      <Badge tone={e.outcome === 'denied' ? 'danger' : 'success'}>
                        {e.outcome === 'denied' ? t.auditDenied : t.auditAllowed}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </Main>
  );
}
