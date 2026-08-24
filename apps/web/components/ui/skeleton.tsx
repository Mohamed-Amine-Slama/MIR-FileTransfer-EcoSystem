import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** Loading placeholder. `animate-pulse` slows to 3s under reduced motion. */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
