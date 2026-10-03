import {
  NotificationPageSchema, NotificationSchema, UnreadCountSchema, ReadAllResponseSchema,
  type Notification, type NotificationListQuery,
} from '@packages/validation';
import { fetchApi, USE_MOCKS, mock } from '@/lib/api-client';
import fixture from '@/mocks/notifications.json';

/** Notification destinations must stay inside this app, even for malformed remote data. */
export function notificationHref(link: string | null): string | null {
  return link && /^\/(?!\/)/.test(link) && !link.includes('\\') && ![...link].some((character) => character.charCodeAt(0) <= 32) ? link : null;
}
export function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ago` : `${Math.floor(minutes / 1440)} days ago`;
}
export function createNotificationMock() {
  const rows: Notification[] = fixture.map((row) => NotificationSchema.parse(row));
  return {
    list(params: Partial<NotificationListQuery> = {}) {
      const page = params.page ?? 1;
      const limit = params.limit ?? 20;
      const filtered = rows.filter((row) => params.unread === 'true' ? !row.readAt : params.unread === 'false' ? Boolean(row.readAt) : true);
      const totalPages = Math.ceil(filtered.length / limit);
      return structuredClone({ data: filtered.slice((page - 1) * limit, page * limit),
        meta: { page, limit, totalItems: filtered.length, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages } });
    },
    count: () => ({ count: rows.filter((row) => !row.readAt).length }),
    read(id: string) {
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error('This notification was not found.');
      row.readAt ??= new Date().toISOString();
      return structuredClone(row);
    },
    readAll() {
      const unread = rows.filter((row) => !row.readAt);
      unread.forEach((row) => { row.readAt = new Date().toISOString(); });
      return { updated: unread.length };
    },
  };
}
const stores = new Map<string, ReturnType<typeof createNotificationMock>>();
const store = (scope: string) => {
  if (!stores.has(scope)) stores.set(scope, createNotificationMock());
  return stores.get(scope)!;
};
export const notificationApi = {
  list: async (scope: string, params: Partial<NotificationListQuery> = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined) query.set(key, String(value)); });
    return NotificationPageSchema.parse(USE_MOCKS ? await mock(store(scope).list(params)) : await fetchApi(`/api/v1/notifications?${query}`));
  },
  count: async (scope: string) => UnreadCountSchema.parse(USE_MOCKS ? await mock(store(scope).count()) : await fetchApi('/api/v1/notifications/unread-count')),
  read: async (scope: string, id: string) => NotificationSchema.parse(USE_MOCKS ? await mock(store(scope).read(id)) : await fetchApi(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })),
  readAll: async (scope: string) => ReadAllResponseSchema.parse(USE_MOCKS ? await mock(store(scope).readAll()) : await fetchApi('/api/v1/notifications/read-all', { method: 'POST' })),
};

