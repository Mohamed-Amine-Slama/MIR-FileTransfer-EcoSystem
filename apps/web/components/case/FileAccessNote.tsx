'use client';

import { History } from 'lucide-react';
import { lastAccessOf, type FileAccessEvent } from '@mir/contracts';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { fileAccessActionLabel, sideLabel } from './labels';

/**
 * "Last accessed by Dr. X on [date]" — brief §4.4 and §5.4 P1.
 *
 * The brief asks for this verbatim, and the reason it matters is not
 * compliance theatre: the referring clinic's real question after uploading a
 * gigabyte of imaging over a bad link is whether anyone on the other side has
 * opened it. A study nobody has touched says so plainly rather than showing
 * nothing, because a blank space reads as "not loaded yet".
 */
export function FileAccessNote({
  events,
  studyId,
}: {
  events: readonly FileAccessEvent[];
  studyId: string;
}): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const latest = lastAccessOf(events, studyId);

  if (latest === null) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`access-${studyId}`}>
        {t.caseFileNeverAccessed}
      </span>
    );
  }

  return (
    <span
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      data-testid={`access-${studyId}`}
    >
      <History className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{t.caseLastAccessed}</span>
      {/* The name is arbitrary script inside a translated sentence, so it is
          isolated: an Arabic label around a Latin name reorders without this. */}
      <bdi className="font-medium text-foreground">{latest.actorDisplayName}</bdi>
      <span>· {sideLabel(t, latest.actorSide)}</span>
      <span>· {fileAccessActionLabel(t, latest.action)}</span>
      <span>· {formatDate(latest.occurredAt)}</span>
    </span>
  );
}
