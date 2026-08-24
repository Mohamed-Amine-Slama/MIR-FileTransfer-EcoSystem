'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import {
  CalendarDays,
  ChevronDown,
  Clock,
  Inbox,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
} from 'lucide-react';
import type { Role } from '@mir/contracts';
import { LOCALE_DIRECTION } from '@mir/contracts';
import { LOCALE_NAMES } from '../lib/i18n/dictionary';
import { useLocale, useT } from '../lib/i18n/provider';
import { useSession } from '../lib/session/session';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
  buttonVariants,
} from './ui';

/**
 * Application chrome: navigation, locale, sign-out.
 *
 * The nav is filtered by role, which is a USABILITY decision and nothing more.
 * A Libyan doctor is not shown the Tunisian inbox because it would be noise,
 * not because hiding the link protects it — the API refuses the route and RLS
 * refuses the rows regardless of what is rendered here.
 *
 * Radix components read direction from DirectionProvider, so menus and the
 * mobile drawer align and animate correctly under Arabic (D4).
 */

interface NavItem {
  href: string;
  label: string;
  roles: readonly Role[];
  Icon: typeof Users;
}

/** The brand mark: two panes handing off — a transfer, which is what MIR is. */
function BrandMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
      <rect x="2.5" y="2.5" width="12" height="12" rx="3" className="fill-primary opacity-35" />
      <rect x="9.5" y="9.5" width="12" height="12" rx="3" className="fill-primary" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { status, user, role, signOut } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer when navigation happens.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const items: NavItem[] = [
    { href: '/patients', label: t.navPatients, roles: ['libya_doctor'], Icon: Users },
    { href: '/upload', label: t.navUpload, roles: ['libya_doctor'], Icon: Upload },
    {
      href: '/appointments',
      label: t.navAppointments,
      roles: ['patient', 'libya_doctor'],
      Icon: CalendarDays,
    },
    { href: '/consent', label: t.navConsents, roles: ['patient'], Icon: ShieldCheck },
    { href: '/doctor', label: t.navInbox, roles: ['tunisia_doctor'], Icon: Inbox },
    { href: '/doctor/availability', label: t.navAvailability, roles: ['tunisia_doctor'], Icon: Clock },
    { href: '/admin/audit', label: t.navAudit, roles: ['admin'], Icon: ScrollText },
  ];

  const visible = role === null ? [] : items.filter((i) => i.roles.includes(role));

  const roleNames: Record<Role, string> = {
    libya_doctor: t.roleLibyaDoctor,
    patient: t.rolePatient,
    tunisia_doctor: t.roleTunisiaDoctor,
    admin: t.roleAdmin,
  };

  // Prefix match so /patients/new keeps /patients highlighted.
  const isCurrent = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <DirectionProvider dir={LOCALE_DIRECTION[locale]}>
      <div className="flex min-h-screen flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          {t.skipToContent}
        </a>

        {/* The institutional band: a 3px primary rule above a calm surface. */}
        <header className="border-b border-t-[3px] border-t-primary bg-card">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
            {/* Mobile: drawer navigation. */}
            {visible.length > 0 && (
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger
                  className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                  aria-label={t.menuOpen}
                >
                  <Menu className="size-5" />
                </SheetTrigger>
                <SheetContent title={t.menuTitle} closeLabel={t.menuClose}>
                  <p className="flex items-center gap-2 text-lg font-bold">
                    <BrandMark />
                    {t.appName}
                  </p>
                  <nav aria-label={t.menuTitle} className="flex flex-col gap-1">
                    {visible.map(({ href, label, Icon }) => (
                      <Link
                        key={href}
                        href={href}
                        aria-current={isCurrent(href) ? 'page' : undefined}
                        className={cn(
                          'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                          isCurrent(href)
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <Icon className="size-4.5" aria-hidden="true" />
                        {label}
                      </Link>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
            )}

            <Link href="/" className="flex items-center gap-2 rounded-md text-lg font-bold tracking-tight">
              <BrandMark />
              {t.appName}
            </Link>

            {/* Desktop: primary navigation. */}
            <nav aria-label={t.menuTitle} className="hidden flex-1 items-center gap-1 md:flex">
              {visible.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isCurrent(href) ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isCurrent(href)
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>

            <div className="ms-auto flex items-center gap-2 md:ms-0">
              <label className="sr-only" htmlFor="locale-select">
                {t.navLanguage}
              </label>
              <Select
                id="locale-select"
                data-testid="locale-switcher"
                className="h-9 w-auto"
                value={locale}
                onChange={(e) => setLocale(e.target.value === 'fr' ? 'fr' : 'ar')}
              >
                {Object.entries(LOCALE_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>

              {status === 'authenticated' && user !== null && role !== null ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    data-testid="current-user"
                    className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm transition-colors hover:border-primary"
                  >
                    <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="max-w-32 truncate">{user.displayName}</span>
                    <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{roleNames[role]}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem data-testid="sign-out" onSelect={() => void signOut()}>
                      <LogOut aria-hidden="true" />
                      {t.navSignOut}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link
                  href="/login"
                  className={buttonVariants({ variant: 'default', size: 'sm' })}
                  data-testid="sign-in-link"
                >
                  {t.navSignIn}
                </Link>
              )}
            </div>
          </div>
        </header>

        <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </div>

        <footer className="border-t bg-card">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <span className="flex items-center gap-1.5 font-medium">
              <BrandMark />
              {t.appName} — {t.appTagline}
            </span>
            <span>{t.footerDisclaimer}</span>
          </div>
        </footer>
      </div>
    </DirectionProvider>
  );
}
