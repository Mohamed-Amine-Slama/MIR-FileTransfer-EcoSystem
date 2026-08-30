import { cn } from '../../lib/utils';

/**
 * A rule between groups of content.
 *
 * Defaults to `role="presentation"`: most rules are decorative, and a screen
 * reader announcing "separator" between every settings section is noise. Pass
 * `semantic` where the line genuinely carries meaning that the heading
 * structure does not already.
 */
export function Separator({
  orientation = 'horizontal',
  semantic = false,
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  semantic?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role={semantic ? 'separator' : 'presentation'}
      aria-orientation={semantic ? orientation : undefined}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}
