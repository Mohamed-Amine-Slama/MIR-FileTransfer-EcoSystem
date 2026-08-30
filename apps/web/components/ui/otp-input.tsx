'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';

/**
 * A six-digit code entry — used by patient record claiming (P5.2) and by email
 * verification at sign-up (§5.1).
 *
 * WHY SIX BOXES RATHER THAN ONE FIELD.
 * The single wide input this replaces worked, but on a phone — where most of
 * these codes are typed — it gives no feedback about how many digits are left
 * and no way to correct the third one without retyping the rest. Six boxes make
 * position visible, which is the whole content of the interaction.
 *
 * WHY THE ROW IS PINNED LTR.
 * A numeric code is read left to right in Arabic as in French. Letting the row
 * follow `dir` would render 481920 as 029184 to an Arabic reader comparing it
 * against their SMS — the digits are in logical order either way, but nobody
 * reads a code logically, they read it positionally. This is the same reason
 * email and phone fields elsewhere are pinned.
 *
 * The value is a plain string, so callers keep validating with
 * `verificationCodeSchema` rather than reassembling an array.
 */

export const OTP_LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
  label,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the sixth digit lands, so a caller can submit without a click. */
  onComplete?: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Names the whole group for screen readers; each box is labelled by position. */
  label: string;
  testId?: string;
}): React.JSX.Element {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.padEnd(OTP_LENGTH, ' ').slice(0, OTP_LENGTH).split('');

  const commit = (next: string): void => {
    const clean = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(clean);
    if (clean.length === OTP_LENGTH) onComplete?.(clean);
  };

  const focusBox = (index: number): void => {
    const target = boxes.current[Math.max(0, Math.min(OTP_LENGTH - 1, index))];
    target?.focus();
    target?.select();
  };

  const handleInput = (index: number, raw: string): void => {
    const typed = raw.replace(/\D/g, '');
    if (typed === '') return;

    // Typing into a box overwrites that position and carries any extra digits
    // forward, so holding a key or a fast typist cannot silently drop input.
    const next = value.split('');
    for (let i = 0; i < typed.length && index + i < OTP_LENGTH; i += 1) {
      next[index + i] = typed[i] ?? '';
    }
    commit(next.join(''));
    focusBox(index + typed.length);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = value.split('');
      if (next[index] !== undefined && next[index] !== '') {
        next[index] = '';
        commit(next.join('').trimEnd());
      } else {
        // Backspace on an empty box clears the one before it and moves there,
        // which is what every code field people have used already does.
        next[index - 1] = '';
        commit(next.join('').trimEnd());
        focusBox(index - 1);
      }
      return;
    }
    // Physical arrows, matched to the pinned-LTR row above.
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    // An SMS or email pasted whole arrives with spaces, a trailing full stop,
    // or surrounding words. Take the digits and ignore the rest rather than
    // rejecting a paste the user reasonably expected to work.
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (pasted === '') return;
    commit(pasted);
    focusBox(pasted.length);
  };

  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      dir="ltr"
      className="flex justify-center gap-2 sm:gap-3"
    >
      {digits.map((digit, index) => (
        <input
          // Position is the identity here; there is nothing else to key on,
          // and the list is a fixed six that never reorders.
          key={index}
          ref={(el) => {
            boxes.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          // Only the first box advertises the one-time code, so a browser
          // autofilling from SMS fills the field rather than six copies of it.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={OTP_LENGTH}
          disabled={disabled}
          value={digit.trim()}
          aria-label={`${label} ${index + 1}`}
          aria-invalid={invalid ? 'true' : undefined}
          data-testid={testId === undefined ? undefined : `${testId}-${index}`}
          onChange={(e) => handleInput(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            'size-12 rounded-md border bg-card text-center text-xl font-semibold text-foreground shadow-sm sm:size-14 sm:text-2xl',
            'transition-colors focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-55',
            invalid ? 'border-danger' : 'border-input',
          )}
        />
      ))}
    </div>
  );
}
