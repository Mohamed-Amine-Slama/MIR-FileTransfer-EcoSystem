'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Main,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui';

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
    <Main>
      <PageHeader title={t.availabilityTitle} description={t.availabilityDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
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
        <Table data-testid="availability-list">
          <TableHeader>
            <TableRow>
              <TableHead>{t.availabilityFrom}</TableHead>
              <TableHead>{t.availabilityTo}</TableHead>
              <TableHead>{t.availabilitySlotMinutes}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {windows.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{formatDate(w.startsAt)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(w.endsAt)}</TableCell>
                <TableCell className="text-muted-foreground">{w.slotMinutes}′</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
