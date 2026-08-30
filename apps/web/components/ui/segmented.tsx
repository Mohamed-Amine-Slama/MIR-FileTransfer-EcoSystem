'use client';

import { cn } from '../../lib/utils';

/**
 * A small set of mutually exclusive choices, shown all at once.
 *
 * Built on native radio inputs inside a `<fieldset>`, so arrow-key navigation,
 * the group name announcement, and form semantics come from the platform
 * rather than from JavaScript this codebase would have to keep correct.
 *
 * Use it where a `<select>` would hide the options behind a click and the set
 * is small enough to show — the theme picker being the case it was built for.
 * Past four or five options, go back to `Select`.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered before the label; decorative, so the label always carries meaning. */
  icon?: React.ReactNode;
}

export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  testId,
}: {
  legend: string;
  /** Must be unique on the page — it is the radio group's identity. */
  name: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
  testId?: string;
}): React.JSX.Element {
  return (
    <fieldset data-testid={testId}>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex rounded-md border bg-muted p-0.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              data-testid={testId === undefined ? undefined : `${testId}-${option.value}`}
              className={cn(
                'relative flex min-h-9 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                selected
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.icon}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
