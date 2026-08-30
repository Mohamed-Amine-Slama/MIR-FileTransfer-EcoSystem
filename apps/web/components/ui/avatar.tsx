import { cn } from '../../lib/utils';

/**
 * A person, drawn as their initials.
 *
 * NO IMAGE. Uploading a photograph would mean storing one, which puts a
 * user-supplied binary and a public-ish URL into a system whose entire storage
 * story is built around medical originals that must never be deletable
 * (`BlobStore` has no delete method, by design). Initials need none of that,
 * and the thing an avatar is actually for here — telling two people apart in a
 * member list — works fine without a face.
 */

/**
 * First letter of the first two words. Uses the code-point iterator rather
 * than `charAt`, so an Arabic name, an accented Latin one, or a name beginning
 * with an astral character yields a whole character instead of half of one.
 */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): React.JSX.Element {
  const sizes = {
    sm: 'size-7 text-xs',
    md: 'size-9 text-sm',
    lg: 'size-16 text-xl',
  };

  return (
    <span
      // The name is on the parent row in every use; repeating it here would
      // make a screen reader say it twice.
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground',
        sizes[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
