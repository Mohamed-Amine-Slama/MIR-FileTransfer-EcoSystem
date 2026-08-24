'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Side drawer for the mobile navigation, built on Radix Dialog.
 *
 * The panel is anchored to the START edge (`start-0`), so it opens from the
 * right under Arabic and the left under French with no per-locale code. No
 * open/close animation — deliberate: instant is honest on slow devices and
 * one less thing to get wrong under reduced motion.
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  title,
  closeLabel,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Accessible dialog title (visually hidden). */
  title: string;
  closeLabel: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex h-full w-3/4 max-w-xs flex-col gap-4 border-e bg-card p-5 shadow-lg outline-none',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close
          className="absolute end-4 top-4 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
