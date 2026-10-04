import { pgTable, varchar, text, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { pk, tstz, createdAt } from './_columns.js';

export type NotificationType =
  | 'LOW_STOCK'
  | 'MEMBERSHIP_EXPIRING'
  | 'MEMBERSHIP_EXPIRED'
  | 'NEW_LEAD'
  | 'ONLINE_ORDER'
  | 'LEAVE_REQUEST'
  | 'LEAVE_DECIDED'
  | 'KITCHEN_READY'
  | 'SHIFT_SWAP';

/**
 * One row per recipient (fan-out at creation). Pairs with the existing
 * notifications:read:self / notifications:update:self permissions.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 24 }).$type<NotificationType>().notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    link: varchar('link', { length: 255 }), // e.g. /crm/<leadId>
    data: jsonb('data').$type<Record<string, unknown>>(),
    dedupeKey: varchar('dedupe_key', { length: 128 }).unique(), // e.g. "low-stock:<productId>:<date>"
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_notifications_user_unread').on(t.userId, t.readAt, t.createdAt)]
);
