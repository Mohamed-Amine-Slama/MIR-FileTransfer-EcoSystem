'use client';

import type { CaseEvent } from '@mir/contracts';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { EmptyState } from '../ui';
import { caseStatusLabel, sideLabel } from './labels';

/**
 * The §5.3 status history, and part of the §4.4 obligation to surface
 * audit-relevant actions back to the user: each row names who moved the case
 * and when, rather than leaving a status that appears to have changed itself.
 *
 * The marker rail uses logical inset (`start-*`) so it stays on the correct
 * side under Arabic without a per-page override.
 */
export function CaseTimeline({ events }: { events: readonly CaseEvent[] }): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  if (events.length === 0) {
    return <EmptyState testId="timeline-empty">{t.caseTimelineEmpty}</EmptyState>;
  }

  return (
    <ol className="relative space-y-5 ps-6" data-testid="case-timeline">
      <span aria-hidden className="absolute bottom-2 start-[5px] top-2 w-px bg-border" />
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className="absolute -start-6 top-1.5 size-[11px] rounded-full border-2 border-background bg-primary"
          />
          <p className="text-sm font-semibold">{caseStatusLabel(t, event.to)}</p>
          <p className="text-xs text-muted-foreground">
            {event.actorDisplayName} · {sideLabel(t, event.actorSide)} · {formatDate(event.occurredAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
