'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_THEME, themeSchema, type Theme } from '@mir/contracts';

/**
 * Theme context — light, dark, or follow the operating system.
 *
 * Modelled on lib/i18n/provider.tsx, deliberately: the two solve the same
 * problem (a preference the server cannot know, applied to <html>), and having
 * them behave differently would mean two sets of hydration rules to remember.
 *
 * WHAT RUNS WHERE, AND WHY THERE IS NO FLASH.
 *   public/theme-init.js  — before paint, sets data-theme from storage.
 *   this provider         — after mount, takes over and keeps them in sync.
 * The provider's first render must therefore agree with the server's HTML, so
 * state starts at DEFAULT_THEME and the stored value is read in an effect. The
 * attribute is already correct by then; the effect is catching the React tree
 * up to the DOM, not the other way round.
 *
 * `system` is a stored value, not the absence of one — see the note on
 * `themeSchema`. It maps to NO attribute, which hands control back to the
 * prefers-color-scheme query in globals.css.
 */

const STORAGE_KEY = 'mir.theme';

interface ThemeContextValue {
  theme: Theme;
  /** What `system` currently resolves to. Null until the effect has run. */
  resolved: 'light' | 'dark' | null;
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyToDocument(theme: Theme): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Reads and writes are wrapped because localStorage throws on ACCESS — not
 * merely returns null — in a private window, with site data blocked, or during
 * a thumbnail capture. A theme preference is never worth a blank page.
 */
function readStored(): Theme | null {
  try {
    const parsed = themeSchema.safeParse(window.localStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* The choice still applies to this page; it just will not survive a reload. */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [systemDark, setSystemDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = readStored();
    if (stored !== null) setThemeState(stored);

    // Tracked so a user on "system" sees the page follow the OS switching at
    // sunset, rather than only at the next reload.
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeStored(next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolved =
      theme === 'system' ? (systemDark === null ? null : systemDark ? 'dark' : 'light') : theme;
    return { theme, resolved, setTheme };
  }, [theme, systemDark, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
