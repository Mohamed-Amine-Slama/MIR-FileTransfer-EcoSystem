'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Role } from '@mir/contracts';
import { LOCALE_NAMES } from '../lib/i18n/dictionary';
import { useLocale, useT } from '../lib/i18n/provider';
import { useSession } from '../lib/session/session';
import { Button } from './ui';

/**
 * Application chrome: navigation, locale, sign-out.
 *
 * The nav is filtered by role, which is a USABILITY decision and nothing more.
 * A Libyan doctor is not shown the Tunisian inbox because it would be noise,
 * not because hiding the link protects it — the API refuses the route and RLS
 * refuses the rows regardless of what is rendered here.
 */

interface NavItem {
  href: string;
  label: string;
  roles: readonly Role[];
}

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { status, user, role, signOut } = useSession();
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: '/patients', label: t.navPatients, roles: ['libya_doctor'] },
    { href: '/upload', label: t.navUpload, roles: ['libya_doctor'] },
    { href: '/appointments', label: t.navAppointments, roles: ['patient', 'libya_doctor'] },
    { href: '/doctor', label: t.navInbox, roles: ['tunisia_doctor'] },
    { href: '/doctor/availability', label: t.navAvailability, roles: ['tunisia_doctor'] },
    { href: '/admin/audit', label: t.navAudit, roles: ['admin'] },
  ];

  const visible = role === null ? [] : items.filter((i) => i.roles.includes(role));

  return (
    <>
      <header className="shell-header">
        <div className="shell-header__inner">
          <Link href="/" className="shell-brand">
            {t.appName}
          </Link>

          <nav className="shell-nav" aria-label={t.navHome}>
            {visible.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shell-nav__link"
                // Prefix match so /patients/new keeps /patients highlighted.
                aria-current={
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                    ? 'page'
                    : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="row">
            <label className="visually-hidden" htmlFor="locale-select">
              {t.navLanguage}
            </label>
            <select
              id="locale-select"
              data-testid="locale-switcher"
              className="select"
              style={{ inlineSize: 'auto' }}
              value={locale}
              onChange={(e) => setLocale(e.target.value === 'fr' ? 'fr' : 'ar')}
            >
              {Object.entries(LOCALE_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>

            {status === 'authenticated' && user !== null ? (
              <>
                <span className="small muted" data-testid="current-user">
                  {user.displayName}
                </span>
                <Button size="sm" onClick={signOut} data-testid="sign-out">
                  {t.navSignOut}
                </Button>
              </>
            ) : (
              <Link href="/login" className="btn btn--sm" data-testid="sign-in-link">
                {t.navSignIn}
              </Link>
            )}
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
