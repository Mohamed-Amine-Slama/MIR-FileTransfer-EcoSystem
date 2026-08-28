import { describe, expect, it } from 'vitest';
import { messageSchema, NOTIFICATION_KINDS, notificationSchema, unreadCount } from './messaging';

const base = {
  id: 'msg-1',
  caseRef: 'MIR-2026-0417',
  authorSide: 'source',
  authorDisplayName: 'Dr. Amal',
  body: 'Films uploaded, please review.',
  sentAt: '2026-08-04T11:30:00.000Z',
};

describe('message', () => {
  it('is scoped to a case, never free-floating (§5.6)', () => {
    expect(messageSchema.parse(base).caseRef).toBe('MIR-2026-0417');
    expect(() => messageSchema.parse({ ...base, caseRef: undefined })).toThrow();
  });

  it('records delivery and read instants separately (§5.6 P1)', () => {
    const parsed = messageSchema.parse({
      ...base,
      deliveredAt: '2026-08-04T11:30:05.000Z',
      readAt: '2026-08-04T11:45:00.000Z',
    });
    expect(parsed.deliveredAt).toBeDefined();
    expect(parsed.readAt).toBeDefined();
  });

  it('refuses a message read before it was delivered', () => {
    expect(() =>
      messageSchema.parse({
        ...base,
        deliveredAt: '2026-08-04T11:45:00.000Z',
        readAt: '2026-08-04T11:30:05.000Z',
      }),
    ).toThrow(/readAt/i);
  });

  it('refuses an empty message body', () => {
    expect(() => messageSchema.parse({ ...base, body: '   ' })).toThrow();
  });
});

describe('notification', () => {
  it('covers the three triggers the brief names (§5.6 P0)', () => {
    expect(NOTIFICATION_KINDS).toEqual(['case_status_changed', 'message_received', 'file_added']);
  });

  it('counts only unread ones, for the §5.6 notification centre badge', () => {
    const notifications = [
      notificationSchema.parse({
        id: 'n1',
        kind: 'message_received',
        caseRef: 'MIR-2026-0417',
        occurredAt: '2026-08-04T11:30:00.000Z',
        titleKey: 'notifMessageReceived',
      }),
      notificationSchema.parse({
        id: 'n2',
        kind: 'file_added',
        caseRef: 'MIR-2026-0417',
        occurredAt: '2026-08-04T12:00:00.000Z',
        titleKey: 'notifFileAdded',
        readAt: '2026-08-04T12:05:00.000Z',
      }),
    ];
    expect(unreadCount(notifications)).toBe(1);
    expect(unreadCount([])).toBe(0);
  });

  it('carries a dictionary key rather than rendered copy, so it translates (§4.2)', () => {
    expect(() =>
      notificationSchema.parse({
        id: 'n3',
        kind: 'file_added',
        caseRef: 'MIR-2026-0417',
        occurredAt: '2026-08-04T12:00:00.000Z',
        titleKey: 'A new file was added',
      }),
    ).toThrow();
  });
});
