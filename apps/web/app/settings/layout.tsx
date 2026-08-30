'use client';

import type { ReactNode } from 'react';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { EVERY_ROLE, PROVIDER_ROLES } from '../../lib/corridor/registry';
import { RoleGate } from '../../components/RoleGate';
import { Main, PageHeader, TabNav, type TabItem } from '../../components/ui';

/**
 * Settings chrome — brief §5.1, §5.5, §5.6, §5.7.
 *
 * THE SECTIONS ARE ROUTES, NOT TABS. `/settings/notifications` is a URL you can
 * bookmark, link from an email, and land on directly; a tablist would have made
 * "open your notification settings" an instruction to click twice. It also
 * means each panel loads only its own data.
 *
 * Team and Billing appear only for provider roles, because both are about an
 * ORGANISATION and a patient has none. That is a usability decision, not a
 * control — the API refuses the routes and row-level security refuses the rows
 * regardless of what is rendered (§4.4).
 */
export default function SettingsLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useT();
  const { role } = useSession();

  const isProvider = role !== null && PROVIDER_ROLES.includes(role);

  const tabs: TabItem[] = [
    { href: '/settings', label: t.settingsAppearance, testId: 'tab-appearance' },
    { href: '/settings/notifications', label: t.settingsNotifications, testId: 'tab-notifications' },
    ...(isProvider
      ? [
          { href: '/settings/team', label: t.settingsTeam, testId: 'tab-team' },
          { href: '/settings/billing', label: t.settingsBilling, testId: 'tab-billing' },
        ]
      : []),
  ];

  return (
    <RoleGate allow={EVERY_ROLE}>
      <Main>
        <PageHeader title={t.settingsTitle} description={t.settingsDescription} />
        <TabNav items={tabs} label={t.settingsTitle} />
        <div className="pt-6">{children}</div>
      </Main>
    </RoleGate>
  );
}
