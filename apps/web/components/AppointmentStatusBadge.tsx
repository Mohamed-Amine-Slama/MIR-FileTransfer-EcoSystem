'use client';

import type { Appointment } from '../lib/api/endpoints';
import { useT } from '../lib/i18n/provider';
import { Badge } from './ui';

/**
 * Appointment status, translated and colour-coded.
 *
 * The status vocabulary is DECISION D2's, and the distinction that matters to
 * a patient is between `authorised` and `confirmed`: their money is HELD, not
 * taken, until the receiving doctor accepts. Rendering both as a generic
 * "pending" would hide the one fact they most need — that they have not been
 * charged yet.
 */
export function AppointmentStatusBadge({
  status,
}: {
  status: Appointment['status'];
}): React.JSX.Element {
  const t = useT();

  const map: Record<Appointment['status'], { tone: 'info' | 'warning' | 'success' | 'danger'; label: string }> = {
    pending_payment: { tone: 'warning', label: t.statusPendingPayment },
    authorised: { tone: 'info', label: t.statusAuthorised },
    confirmed: { tone: 'success', label: t.statusConfirmed },
    cancelled: { tone: 'danger', label: t.statusCancelled },
    expired: { tone: 'danger', label: t.statusExpired },
  };

  const { tone, label } = map[status];
  return (
    <Badge tone={tone} testId="appointment-status">
      {label}
    </Badge>
  );
}
