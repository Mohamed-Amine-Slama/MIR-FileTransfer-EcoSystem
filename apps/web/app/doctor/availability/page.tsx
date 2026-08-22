'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Spinner } from '../../../components/ui';

/**
 * Availability management — BUILD_SPEC P10.1.
 *
 * TIMEZONES ARE THE ENTIRE RISK HERE. The doctor is in Tunis, the patient is
 * in Tripoli, and the two are not always the same offset. `datetime-local`
 * yields a wall-clock string with no zone, so it is converted through the
 * browser's own zone into a UTC instant before it is sent — the API stores
 * instants, never wall-clock times (P10.1's explicit gate).
 *
 * Everything displayed back is rendered with an explicit zone label, so a
 * doctor can see that the window they entered as 09:00 local is the 09:00 the
 * patient will be offered.
 */
export default function AvailabilityPage(): React.JSX.Element {
  return (
    <RoleGate allow={['tunisia_doctor']}>
      <AvailabilityEditor />
    </RoleGate>
  );
}

interface Window {
  id: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
}

function AvailabilityEditor(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [windows, setWindows] = useState<Window[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [slotMinutes, setSlotMinutes] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { windows: rows } = await api.scheduling.listAvailability();
      setWindows(rows);
    } catch {
      setError(t.genericError);
      setWindows([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const valid = from !== '' && to !== '' && new Date(to) > new Date(from);

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.scheduling.addAvailability({
        // `new Date(localString).toISOString()` is the conversion: the browser
        // interprets the naive string in ITS zone, then serialises the instant.
        startsAt: new Date(from).toISOString(),
        endsAt: new Date(to).toISOString(),
        slotMinutes: Number(slotMinutes),
      });
      setFrom('');
      setTo('');
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="stack">
      <PageHeader title={t.availabilityTitle} description={t.availabilityDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label={t.availabilityFrom}>
            <Input
              data-testid="availability-from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t.availabilityTo}>
            <Input
              data-testid="availability-to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label={t.availabilitySlotMinutes}>
            <Input
              data-testid="availability-slot-minutes"
              type="number"
              min={5}
              max={240}
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" data-testid="add-availability" disabled={!valid || busy}>
            {t.availabilityAdd}
          </Button>
        </form>
      </Card>

      {windows === null ? (
        <Spinner label={t.loading} />
      ) : windows.length === 0 ? (
        <EmptyState testId="availability-empty">{t.availabilityEmpty}</EmptyState>
      ) : (
        <ul className="list" data-testid="availability-list">
          {windows.map((w) => (
            <li key={w.id} className="list__item">
              <span style={{ flex: 1 }}>{formatDate(w.startsAt)}</span>
              <span className="muted small">{formatDate(w.endsAt)}</span>
              <span className="muted small">{w.slotMinutes}′</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
