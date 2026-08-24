import { cn } from '../../lib/utils';

/**
 * Determinate progress bar (plain markup, no Radix — the upload page must
 * stay light). The label relationship is the caller's: pass `aria-label` or
 * surrounding text.
 */
export function Progress({
  value,
  className,
  ...rest
}: {
  /** 0–100 */
  value: number;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...rest}
    >
      <div
        className="h-full rounded-full bg-primary transition-[inline-size]"
        style={{ inlineSize: `${clamped}%` }}
      />
    </div>
  );
}
