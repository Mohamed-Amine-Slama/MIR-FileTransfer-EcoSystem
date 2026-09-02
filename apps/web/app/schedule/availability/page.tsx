'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type AvailabilityRule, type AvailabilityWindow } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { ISO_WEEKDAYS, weekdayLabel, type IsoWeekday } from '../../../lib/scheduling/labels';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
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
 * Opening hours — the weekly pattern, and the exceptions to it.
 *
 * A WEEKLY RULE GENERATES CONCRETE WINDOWS rather than being consulted at
 * booking time, so the list below shows exactly what a patient will be offered.
 * That also means a doctor can withdraw a single Tuesday without abolishing
 * every Tuesday, which is the case that made rules-as-a-query untenable.
 *
 * The time zone is asked for and not inferred. "Every Tuesday at 09:00" is a
 * statement about the clinic's own clock, and a browser guess is wrong the
 * moment somebody administers the calendar from another country — which, for a
 * cross-border product, is the ordinary case rather than the exotic one.
 */
export default function AvailabilityPage(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [weekday, setWeekday] = useState<IsoWeekday>(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');
  const [slotMinutes, setSlotMinutes] = useState('30');
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ rules: r }, { windows: w }] = await Promise.all([
        api.scheduling.listRules(),
        api.scheduling.listAvailability(),
      ]);
      setRules(r);
      setWindows(w);
    } catch {
      setError(t.genericError);
      setRules([]);
      setWindows([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      // 409 here means the window still has patients in it — a refusal with a
      // specific remedy, not a generic failure.
      setError(
        err instanceof ApiError && err.isConflict ? t.scheduleWithdrawBlocked : t.genericError,
      );
    } finally {
      setBusy(false);
    }
  };

  const ruleValid = endTime > startTime;
  const windowValid = from !== '' && to !== '' && new Date(to) > new Date(from);

  return (
    <div className="space-y-6">
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card title={t.scheduleRecurring}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api.scheduling.addRule({
                weekday,
                startTime,
                endTime,
                timezone,
                slotMinutes: Number(slotMinutes),
              }),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t.scheduleWeekday}>
              <Select
                data-testid="rule-weekday"
                value={String(weekday)}
                onChange={(e) => setWeekday(Number(e.target.value) as IsoWeekday)}
              >
                {ISO_WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {weekdayLabel(d, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.scheduleFrom}>
              <Input
                data-testid="rule-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
            <Field label={t.scheduleTo}>
              <Input
                data-testid="rule-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>
            <Field label={t.availabilitySlotMinutes}>
              <Input
                data-testid="rule-slot-minutes"
                type="number"
                min={5}
                max={240}
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(e.target.value)}
              />
            </Field>
          </div>

          <p className="text-muted-foreground">
            {t.scheduleTimezone}: <span dir="ltr">{timezone}</span>
          </p>

          <Button type="submit" variant="primary" data-testid="add-rule" disabled={!ruleValid || busy}>
            {t.scheduleRecurringAdd}
          </Button>
        </form>

        <div className="pt-4">
          {rules === null ? (
            <Spinner label={t.loading} />
          ) : rules.length === 0 ? (
            <EmptyState testId="rules-empty">{t.scheduleRecurringEmpty}</EmptyState>
          ) : (
            <Table data-testid="rules-list">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.scheduleWeekday}</TableHead>
                  <TableHead>{t.scheduleFrom}</TableHead>
                  <TableHead>{t.scheduleTo}</TableHead>
                  <TableHead>{t.scheduleTimezone}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id} data-testid="rule-row">
                    <TableCell className="font-medium">
                      {weekdayLabel(r.weekday as IsoWeekday, t)}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.startTime}</TableCell>
                    <TableCell className="tabular-nums">{r.endTime}</TableCell>
                    <TableCell className="text-muted-foreground" dir="ltr">
                      {r.timezone}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="default"
                        data-testid="withdraw-rule"
                        disabled={busy}
                        onClick={() => void run(() => api.scheduling.withdrawRule(r.id))}
                      >
                        {t.scheduleWithdraw}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <Card title={t.scheduleOneOff}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.scheduling.addAvailability({
                // The browser interprets the naive string in ITS zone, then
                // serialises the instant — the API stores instants, never
                // wall-clock times (P10.1's explicit gate).
                startsAt: new Date(from).toISOString(),
                endsAt: new Date(to).toISOString(),
                slotMinutes: Number(slotMinutes),
              });
              setFrom('');
              setTo('');
            });
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
          <Button
            type="submit"
            variant="primary"
            data-testid="add-availability"
            disabled={!windowValid || busy}
          >
            {t.availabilityAdd}
          </Button>
        </form>

        <div className="pt-4">
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {windows.map((w) => (
                  <TableRow key={w.id} data-testid="availability-row">
                    <TableCell className="font-medium">{formatDate(w.startsAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(w.endsAt)}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {w.slotMinutes}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="default"
                        data-testid="withdraw-window"
                        disabled={busy}
                        onClick={() => void run(() => api.scheduling.withdrawAvailability(w.id))}
                      >
                        {t.scheduleWithdraw}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
