import type { ReactNode } from 'react';
import { LOCALE_DIRECTION, type Locale } from '@mir/contracts';
import { AppShell } from '../components/AppShell';
import { LocaleProvider } from '../lib/i18n/provider';
import { SessionProvider } from '../lib/session/session';
import './globals.css';

export const metadata = {
  title: 'MIR — Medical Imaging Referral',
  description: 'Cross-border medical imaging transfer and scheduling',
};

// DECISION D4: Arabic and French, RTL from day one. Arabic is the default
// because the referring side (Libya) and most patients are Arabic-speaking.
// Direction is driven off the locale table in @mir/contracts rather than
// hardcoded, so a locale can never ship with the wrong direction.
//
// These attributes are the SERVER's guess. LocaleProvider replaces them after
// mount once the user's stored preference is known; rendering the default here
// is what keeps the first paint free of a hydration mismatch.
const DEFAULT_LOCALE: Locale = 'ar';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir={LOCALE_DIRECTION[DEFAULT_LOCALE]}>
      <body>
        <LocaleProvider>
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
