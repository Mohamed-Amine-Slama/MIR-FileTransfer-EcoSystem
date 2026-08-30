'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import { UI_LOCALE_DIRECTION } from '@mir/contracts';
import { useLocale } from '../lib/i18n/provider';
import { useSession } from '../lib/session/session';
import { AppChrome } from './shell/AppChrome';
import { PublicChrome } from './shell/PublicChrome';

/**
 * Picks which chrome a route gets.
 *
 * The product has two registers (§4.1): a calm, dense, sidebar-shaped
 * application for people moving patient data, and an expressive public surface
 * for people deciding whether to sign up. This is the seam between them.
 *
 * WHY PATHNAME AND NOT ROUTE GROUPS. Moving the existing screens into an
 * `(app)/` group would rewrite the path of every file in the ratcheting
 * allowlist in `lib/corridor/no-hardcoded-corridor.test.ts` and in the e2e
 * suite, for no behavioural gain. One list, read here, does the same job.
 *
 * `/` is the exception that needs both: a visitor sees the landing page, and a
 * signed-in user sees their dashboard. It is resolved on session status rather
 * than on the path.
 *
 * Radix components read direction from DirectionProvider, so menus and the
 * mobile drawer align and animate correctly under Arabic (D4). It wraps BOTH
 * chromes — the public surface has a dropdown too.
 */

/**
 * Routes that belong to the public surface.
 *
 * `/signup/provider` and `/verification` are deliberately ABSENT even though
 * they are part of onboarding: both require a session, both are the point at
 * which someone becomes a user of the product rather than a visitor to the
 * site, and both need the account menu that only the application chrome has.
 */
const PUBLIC_PREFIXES = ['/pricing', '/login', '/signup', '/reset-password', '/invite'] as const;

const APPLICATION_EXCEPTIONS = ['/signup/provider'] as const;

export function isPublicPath(pathname: string): boolean {
  if (APPLICATION_EXCEPTIONS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false;
  }
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { locale } = useLocale();
  const { status, role } = useSession();
  const pathname = usePathname();

  // While the session is still resolving, the landing page is the safe guess
  // for `/`: it renders for everyone, whereas the dashboard would flash a
  // signed-out state at a signed-in user before correcting itself.
  const publicSurface = isPublicPath(pathname) || (pathname === '/' && status !== 'authenticated');

  return (
    <DirectionProvider dir={UI_LOCALE_DIRECTION[locale]}>
      {publicSurface ? (
        <PublicChrome>{children}</PublicChrome>
      ) : (
        <AppChrome role={role}>{children}</AppChrome>
      )}
    </DirectionProvider>
  );
}
