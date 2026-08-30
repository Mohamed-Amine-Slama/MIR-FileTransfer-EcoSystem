'use client';

import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { THEMES, type Theme } from '@mir/contracts';
import { useT } from '../../lib/i18n/provider';
import { useTheme } from '../../lib/theme/theme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui';

/**
 * The theme control in the application chrome.
 *
 * A MENU WITH WRITTEN LABELS, NOT A CYCLING ICON BUTTON. §4.1 asks for
 * "clear labels and explicit states over icon-only or gesture-based UI", and a
 * button that cycles light -> dark -> system gives no way to know what the next
 * press does or which of the three is currently in force. The menu says both.
 *
 * The trigger's icon shows the RESOLVED appearance rather than the stored
 * choice, so someone on "system" at night sees a moon — which is what their
 * screen actually looks like. `resolved` is null until the provider's effect
 * has run; the sun is the neutral stand-in for that one frame.
 */
export function ThemeToggle(): React.JSX.Element {
  const t = useT();
  const { theme, resolved, setTheme } = useTheme();

  const icons: Record<Theme, typeof Sun> = {
    light: Sun,
    dark: Moon,
    system: Monitor,
  };

  const labels: Record<Theme, string> = {
    light: t.themeLight,
    dark: t.themeDark,
    system: t.themeSystem,
  };

  const TriggerIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="theme-toggle"
        aria-label={t.themeLabel}
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <TriggerIcon className="size-4.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t.themeLabel}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((option) => {
          const Icon = icons[option];
          const selected = theme === option;
          return (
            <DropdownMenuItem
              key={option}
              data-testid={`theme-option-${option}`}
              onSelect={() => setTheme(option)}
            >
              <Icon aria-hidden="true" />
              <span className="flex-1">{labels[option]}</span>
              {/* The tick is the state, and it is not carried by colour alone. */}
              {selected && <Check className="size-4 text-primary" aria-hidden="true" />}
              {selected && <span className="sr-only">✓</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
