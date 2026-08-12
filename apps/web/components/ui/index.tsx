import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/**
 * Shared UI primitives.
 *
 * Deliberately small and unabstracted. These exist so that spacing, focus
 * rings, and the RTL-safe class names live in ONE place — not to build a
 * component framework. Every visual decision is a CSS class in globals.css;
 * nothing here computes styles, because inline styles do not flip under `dir`
 * and would quietly reintroduce the physical-direction bug D4 forbids.
 */

type Tone = 'info' | 'warning' | 'danger' | 'success';

// ---------------------------------------------------------------------------

export function Button({
  variant = 'default',
  size,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm';
}): React.JSX.Element {
  const classes = [
    'btn',
    variant === 'default' ? null : `btn--${variant}`,
    size === undefined ? null : `btn--${size}`,
    className,
  ]
    .filter((c) => c !== null && c !== undefined)
    .join(' ');
  // type defaults to "submit" inside a form, which turns an unrelated button
  // into an accidental submit. Callers opt in to submitting explicitly.
  return <button type="button" {...rest} className={classes} />;
}

// ---------------------------------------------------------------------------

export function Card({
  title,
  children,
  actions,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <section className="card">
      {(title !== undefined || actions !== undefined) && (
        <div className="row row--between">
          {title !== undefined && <h2 className="card__title">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * A labelled control.
 *
 * The label WRAPS the input rather than using htmlFor/id. Generated ids are a
 * recurring source of hydration mismatches in Next, and a wrapping label is
 * associated natively with no id at all.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint !== undefined && error == null && <span className="field__hint">{hint}</span>}
      {error != null && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function Input({
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }): React.JSX.Element {
  return <input {...rest} className="input" aria-invalid={invalid === true ? 'true' : undefined} />;
}

export function Select({
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select {...rest} className="select">
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------

export function Alert({
  tone = 'info',
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <div
      className={`alert alert--${tone}`}
      data-testid={testId}
      // Errors must be announced; informational text must not interrupt.
      role={tone === 'danger' ? 'alert' : undefined}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone,
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <span className={tone === undefined ? 'badge' : `badge badge--${tone}`} data-testid={testId}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function Spinner({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="muted small">{label}</span>
    </span>
  );
}

export function EmptyState({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <div className="empty" data-testid={testId}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="stack-sm" style={{ marginBlockEnd: 'var(--space-lg)' }}>
      <div className="row row--between">
        <h1 style={{ margin: 0 }}>{title}</h1>
        {actions}
      </div>
      {description !== undefined && <p className="muted" style={{ margin: 0 }}>{description}</p>}
    </header>
  );
}

/** Progress indicator for the multi-step booking flow. */
export function Steps({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}): React.JSX.Element {
  return (
    <ol className="steps" data-testid="steps">
      {steps.map((label, i) => (
        <li
          key={label}
          className="steps__item"
          data-done={i < current ? 'true' : 'false'}
          aria-current={i === current ? 'step' : undefined}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}
