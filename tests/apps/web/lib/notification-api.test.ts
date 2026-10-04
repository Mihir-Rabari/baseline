import { describe, expect, it } from 'vitest';
import { NotificationPageSchema } from '@packages/validation';
import { createNotificationMock, notificationHref } from '../../../../apps/web/src/lib/notification-api';

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
  it('accepts a shift swap notification and sends it to the shifts page', () => {
    const row = { id: 'b0000000-0000-4000-8000-000000000999', type: 'SHIFT_SWAP', title: 'Shift swap needs approval', body: 'Ben agreed to take a shift.', link: '/shifts', data: { swapId: 'x' }, readAt: null, createdAt: '2026-10-03T09:26:29.039Z' };
    const parsed = NotificationPageSchema.parse({ data: [row], meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false } });
    expect(parsed.data[0].type).toBe('SHIFT_SWAP');
    expect(notificationHref(parsed.data[0].link)).toBe('/shifts');
  });
});
