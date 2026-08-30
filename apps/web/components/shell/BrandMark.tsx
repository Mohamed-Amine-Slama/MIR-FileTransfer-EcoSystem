import { cn } from '../../lib/utils';

/** The brand mark: two panes handing off — a transfer, which is what MIR is. */
export function BrandMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6 shrink-0', className)} aria-hidden="true">
      <rect x="2.5" y="2.5" width="12" height="12" rx="3" className="fill-primary opacity-35" />
      <rect x="9.5" y="9.5" width="12" height="12" rx="3" className="fill-primary" />
    </svg>
  );
}
