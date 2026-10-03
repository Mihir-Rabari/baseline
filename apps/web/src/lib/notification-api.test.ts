import { describe, expect, it } from 'vitest';
import { NotificationPageSchema } from '@packages/validation';
import { createNotificationMock, notificationHref } from './notification-api';

describe('Notification state', () => {
  it('marks one read once, decreases the badge count and marks only remaining unread rows', () => {
    const state = createNotificationMock();
    const first = state.list({ limit: 8 }).data[0];
    expect(state.count().count).toBe(4);
    const read = state.read(first.id);
    expect(read.readAt).not.toBeNull();
    expect(state.read(first.id).readAt).toBe(read.readAt);
    expect(state.count().count).toBe(3);
    expect(state.list({ unread: 'true' }).data.some((row) => row.id === first.id)).toBe(false);
    expect(state.readAll().updated).toBe(3);
    expect(state.readAll().updated).toBe(0);
    expect(state.count().count).toBe(0);
    expect(NotificationPageSchema.safeParse(state.list()).success).toBe(true);
  });
  it('isolates independent users and paginates without losing unread state', () => {
    const first = createNotificationMock(); const second = createNotificationMock();
    first.readAll();
    expect(second.count().count).toBe(4);
    expect(second.list({ page: 2, limit: 2 }).data).toHaveLength(2);
    expect(second.list({ page: 2, limit: 2 }).meta.hasPrevPage).toBe(true);
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/\n/evil', null])('rejects unsafe notification destination %j', (link) => {
    expect(notificationHref(link)).toBeNull();
  });
  it('permits local app routes with a query string', () => {
    expect(notificationHref('/orders?status=PLACED')).toBe('/orders?status=PLACED');
  });
});
