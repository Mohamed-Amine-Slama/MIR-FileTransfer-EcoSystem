'use client';

import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * An on/off control, built on a native checkbox.
 *
 * NOT a Radix primitive, for the same reason `Select` in index.tsx is a native
 * `<select>`: it works on old clinic browsers, costs no JavaScript, is
 * keyboard- and screen-reader-correct with no roving-tabindex code to get
 * wrong, and Playwright's `check()` keeps working against it.
 *
 * `role="switch"` is the one addition. On a checkbox it changes the announced
 * state from "checked/unchecked" to "on/off", which is what a settings toggle
 * means; the input remains a checkbox for every other purpose.
 *
 * The track is drawn with logical inset properties so the knob travels toward
 * the reading direction's end under Arabic as under French (D4).
 */
export function Switch({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex h-6 w-11 shrink-0', className)}>
      <input
        {...rest}
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-full border border-input bg-muted transition-colors',
          'peer-checked:border-primary peer-checked:bg-primary',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
          'peer-disabled:opacity-55',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-0.5 size-5 rounded-full bg-card shadow-sm transition-[inset-inline-start]',
          // Logical offsets: under RTL the knob slides toward the left edge,
          // which is that layout's "end", with no second rule.
          'start-0.5 peer-checked:start-[1.375rem]',
        )}
      />
    </span>
  );
}
