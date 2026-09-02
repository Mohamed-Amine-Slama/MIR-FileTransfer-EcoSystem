'use client';

import type { ReactNode } from 'react';
import { useT } from '../../lib/i18n/provider';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import { RoleGate } from '../../components/RoleGate';
import { Main, PageHeader, TabNav, type TabItem } from '../../components/ui';

/**
 * The practice calendar — one place to run a doctor's diary.
 *
 * WHAT THIS REPLACED. Everything a practice does with its appointments was
 * spread across five screens: an inbox at /doctor, a bare "add a window" form
 * at /doctor/availability, and three /appointments screens written for a
 * patient booking a referral. None of them answered "what is happening today",
 * which is the question a clinic actually opens a calendar to ask.
 *
 * BOTH SIDES OF THE CORRIDOR, gated by side rather than by role name (§4.3) —
 * a referring clinic runs a diary exactly as a receiving one does. `assistant`
 * is listed literally because it is NOT a corridor endpoint: like `patient` and
 * `admin` it plays no side, so `rolesForSides` has nothing to say about it.
 *
 * Sections are ROUTES, not tabs, following /settings: "open the calendar" is a
 * link you can send someone, and each panel loads only its own data.
 */
export default function ScheduleLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useT();

  const tabs: TabItem[] = [
    { href: '/schedule', label: t.scheduleToday, testId: 'tab-agenda' },
    { href: '/schedule/calendar', label: t.scheduleCalendar, testId: 'tab-calendar' },
    {
      href: '/schedule/availability',
      label: t.scheduleAvailabilityTab,
      testId: 'tab-availability',
    },
  ];

  return (
    <RoleGate allow={[...PROVIDER_ROLES, 'assistant']}>
      <Main wide>
        <PageHeader title={t.navSchedule} description={t.scheduleDescription} />
        <TabNav items={tabs} label={t.navSchedule} />
        <div className="pt-6">{children}</div>
      </Main>
    </RoleGate>
  );
}
