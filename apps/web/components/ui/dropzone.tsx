'use client';

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * A drop target that is also a button.
 *
 * WHY THE FILE INPUT SURVIVES.
 * Drag-and-drop is an enhancement, never the only route in. A doctor on a
 * tablet has nothing to drag, a keyboard user cannot drag at all, and the
 * upload screen picks a whole DIRECTORY off a CD — which no drop handler can
 * offer and only `webkitdirectory` on a real `<input type="file">` can. So the
 * input stays, keeps the label, and the drop surface is layered over it.
 *
 * The dragging state is counted rather than flagged. `dragleave` fires when the
 * pointer crosses onto a CHILD element, so a boolean flickers off and on as the
 * cursor moves over the icon and the text inside the zone; a depth counter is
 * what makes the highlight steady.
 */
/**
 * Non-standard, universally supported, and absent from React's
 * InputHTMLAttributes. Declared once as an index-signature record so the
 * spread typechecks, rather than sprinkling `@ts-expect-error` at each use —
 * a suppression that stops matching an error becomes an error itself.
 *
 * `webkitdirectory` is the attribute browsers honour; `directory` is the
 * standards-track spelling, harmless where unimplemented.
 */
const DIRECTORY_ATTRS: Record<string, string> = { webkitdirectory: '', directory: '' };

export function Dropzone({
  onFiles,
  label,
  hint,
  accept,
  directory = false,
  multiple = true,
  disabled = false,
  testId,
  children,
}: {
  onFiles: (files: File[]) => void;
  label: string;
  hint?: string;
  accept?: string;
  /** Picks a folder and everything under it — the shape of a real DICOM export. */
  directory?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  /** Applied to the file input. The drop surface gets `${testId}-zone`. */
  testId?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // Without preventDefault the browser NAVIGATES to the dropped file,
      // discarding the page and any queued uploads with it.
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const dropped = Array.from(event.dataTransfer.files);
      if (dropped.length > 0) onFiles(dropped);
    },
    [disabled, onFiles],
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      data-testid={testId === undefined ? undefined : `${testId}-zone`}
      data-dragging={dragging ? 'true' : 'false'}
      className={cn(
        'rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
        disabled && 'opacity-55',
        dragging ? 'border-primary bg-accent' : 'border-border bg-muted/40',
      )}
    >
      <div className="flex flex-col items-center gap-2">
        {children}
        <label
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90',
            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
            disabled && 'pointer-events-none',
          )}
        >
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            /*
             * The caller's id goes on the INPUT, not on the drop surface.
             * Automation drives a file picker with setInputFiles, which needs
             * the input element itself; the zone gets the derived `-zone` id
             * for the rarer case of asserting on drag state.
             */
            data-testid={testId}
            {...(directory ? DIRECTORY_ATTRS : {})}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              if (selected.length > 0) onFiles(selected);
              // Reset, so selecting the SAME folder twice fires change twice.
              // Without this a retry after a failure silently does nothing.
              event.target.value = '';
            }}
          />
          {label}
        </label>
        {hint !== undefined && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
