import { usageRatio } from '@mir/contracts';
import { cn } from '../../lib/utils';

/**
 * Usage against an allowance — seats filled, cases submitted this period.
 *
 * WHY IT RENDERS NOTHING FOR AN UNLIMITED ALLOWANCE.
 * `usageRatio` returns null when the limit is null, and this draws no bar in
 * that case. A bar at 0% implies a ceiling, and an unlimited tier has none;
 * showing one would quietly tell a Network customer they are near a limit that
 * does not exist.
 *
 * The numbers are stated in text beside it. The bar is an at-a-glance
 * summary, never the only place the value appears — §4.1 asks for explicit
 * states over graphical ones on anything a decision hangs on.
 */
export function Meter({
  label,
  used,
  limit,
  unlimitedLabel,
  testId,
}: {
  label: string;
  used: number;
  limit: number | null;
  unlimitedLabel: string;
  testId?: string;
}): React.JSX.Element {
  const ratio = usageRatio(used, limit);
  const full = ratio !== null && ratio >= 1;

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={cn('tabular-nums', full ? 'font-semibold text-warning' : 'text-muted-foreground')}>
          {limit === null ? (
            <>
              {used} · {unlimitedLabel}
            </>
          ) : (
            `${used} / ${limit}`
          )}
        </span>
      </div>
      {ratio !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit ?? undefined}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            // Width, not a transform: a transform would need the origin flipped
            // under RTL, and a width fills from the inline start in both.
            className={cn('h-full rounded-full transition-[width]', full ? 'bg-warning' : 'bg-primary')}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
