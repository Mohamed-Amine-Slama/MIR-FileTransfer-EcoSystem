import { z } from 'zod';
import { caseRefSchema } from './case';
import { caseSideSchema } from './corridor';

/**
 * Messaging and notifications — brief §5.6.
 *
 * Messages are scoped to a case by construction: `caseRef` is required, so a
 * message belonging to no case cannot be represented. That is what keeps
 * §5.6's "scoped to a case" from depending on a query filter someone forgets
 * to apply.
 *
 * Author identity is a SIDE plus a display name, never a country or a role —
 * §4.3 again. A view renders "the destination clinic replied" without ever
 * learning which country that is.
 */

export const messageSchema = z
  .object({
    id: z.string().min(1),
    caseRef: caseRefSchema,
    authorSide: caseSideSchema,
    authorDisplayName: z.string().min(1),
    body: z.string().trim().min(1),
    sentAt: z.string().datetime(),
    deliveredAt: z.string().datetime().optional(),
    readAt: z.string().datetime().optional(),
  })
  .refine(
    (m) =>
      m.readAt === undefined ||
      (m.deliveredAt !== undefined && Date.parse(m.readAt) >= Date.parse(m.deliveredAt)),
    { message: 'readAt cannot precede deliveredAt', path: ['readAt'] },
  );
export type Message = z.infer<typeof messageSchema>;

/** The three triggers §5.6 P0 names. */
export const NOTIFICATION_KINDS = [
  'case_status_changed',
  'message_received',
  'file_added',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.string().min(1),
  kind: notificationKindSchema,
  caseRef: caseRefSchema,
  occurredAt: z.string().datetime(),
  /** Dictionary key, not copy. Same rule as FieldSpec.labelKey. */
  titleKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'titleKey must be a dictionary key'),
  readAt: z.string().datetime().optional(),
});
export type Notification = z.infer<typeof notificationSchema>;

export function unreadCount(notifications: readonly Notification[]): number {
  return notifications.filter((n) => n.readAt === undefined).length;
}
