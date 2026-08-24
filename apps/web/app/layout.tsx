import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { LOCALE_DIRECTION, type Locale } from '@mir/contracts';
import { AppShell } from '../components/AppShell';
import { LocaleProvider } from '../lib/i18n/provider';
import { SessionProvider } from '../lib/session/session';
import './globals.css';

export const metadata = {
  title: 'MIR — Medical Imaging Referral',
  description: 'Cross-border medical imaging transfer and scheduling',
};

// One family for both scripts (D4): IBM Plex Sans Arabic ships full Arabic
// coverage plus Latin, so Arabic and French render with the same voice.
//
// VENDORED, not fetched from Google Fonts. next/font/google downloads at
// build time, and when that fetch fails — as it does inside a Docker build
// on a flaky or restricted network — Next silently falls back to system
// fonts and still exits 0, so the deployment image ships without its
// typeface and nothing fails. The files live in app/fonts/ (OFL 1.1,
// LICENSE.txt beside them), which makes the image build hermetic.
//
// `display: swap` keeps first paint on the system stack, which is what keeps
// the viewer's 5-second budget (P9.1) out of the font's hands.
const plex = localFont({
  src: [
    { path: './fonts/IBMPlexSansArabic-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-Bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex',
});

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
    <html lang={DEFAULT_LOCALE} dir={LOCALE_DIRECTION[DEFAULT_LOCALE]} className={plex.variable}>
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
