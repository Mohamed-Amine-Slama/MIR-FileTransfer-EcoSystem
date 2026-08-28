'use client';

import type { CaseStatus } from '@mir/contracts';
import { useT } from '../../lib/i18n/provider';
import { Badge } from '../ui';
import { caseStatusLabel, caseStatusTone } from './labels';

/**
 * The one place a case status becomes visible text.
 *
 * Provider and admin screens both render this, which is how §5.3's "shown
 * consistently across provider and admin views" stays true without anybody
 * having to remember it.
 */
export function CaseStatusBadge({ status }: { status: CaseStatus }): React.JSX.Element {
  const t = useT();
  return (
    <Badge tone={caseStatusTone(status)} testId={`case-status-${status}`}>
      {caseStatusLabel(t, status)}
    </Badge>
  );
}
