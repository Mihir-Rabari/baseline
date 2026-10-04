import { tenantIdColumn } from './_tenant.js';
import {
  pgTable,
  varchar,
  text,
  uuid,
  smallint,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';
import { members } from './members.js';
import { pk, tstz, createdAt, updatedAt, paise } from './_columns.js';

/** A `categories.code` in the MENU scope. */
export type MenuCategory = string;
export type TabStatus = 'OPEN' | 'SETTLED' | 'VOID';
export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export type TabItemStatus = 'PENDING' | 'SENT' | 'VOID';
export type TableBookingStatus = 'BOOKED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export const barTables = pgTable('bar_tables', {
    tenantId: tenantIdColumn(),
  id: pk(),
  name: varchar('name', { length: 32 }).notNull().unique(), // "T1"
  seats: smallint('seats').notNull().default(4),
  isActive: boolean('is_active').notNull().default(true),
});

export const menuItems = pgTable(
  'menu_items',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    name: varchar('name', { length: 128 }).notNull(),
    category: varchar('category', { length: 16 }).$type<MenuCategory>().notNull(),
    station: varchar('station', { length: 16 }).$type<'BAR' | 'KITCHEN'>().notNull().default('KITCHEN'),
    pricePaise: paise('price_paise').notNull(),
    discountable: boolean('discountable').notNull().default(true),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    imageUrl: varchar('image_url', { length: 512 }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_menu_items_category').on(t.category)]
);

export const tabs = pgTable(
  'tabs',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    tabNumber: integer('tab_number').notNull().unique(), // from tab_number_seq
    memberId: uuid('member_id').references(() => members.id),
    guestName: varchar('guest_name', { length: 255 }),
    tableId: uuid('table_id').references(() => barTables.id),
    status: varchar('status', { length: 12 }).$type<TabStatus>().notNull().default('OPEN'),
    openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
    openedAt: tstz('opened_at').defaultNow().notNull(),
    settledBy: uuid('settled_by').references(() => users.id, { onDelete: 'set null' }),
    settledAt: tstz('settled_at'),
    subtotalPaise: paise('subtotal_paise'), // frozen at settle
    discountPaise: paise('discount_paise'),
    totalPaise: paise('total_paise'),
    shiftId: uuid('shift_id'), // FK added in SQL (0003)
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_tabs_one_open_per_table')
      .on(t.tableId)
      .where(sql`${t.status} = 'OPEN'`),
    index('idx_tabs_status').on(t.status, t.openedAt),
    index('idx_tabs_settled_at').on(t.settledAt),
  ]
);

export const kitchenTickets = pgTable(
  'kitchen_tickets',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    ticketNumber: integer('ticket_number').generatedAlwaysAsIdentity().notNull().unique(),
    tabId: uuid('tab_id')
      .references(() => tabs.id, { onDelete: 'cascade' })
      .notNull(),
    station: varchar('station', { length: 16 }).$type<'BAR' | 'KITCHEN'>().notNull().default('KITCHEN'),
    status: varchar('status', { length: 12 }).$type<TicketStatus>().notNull().default('NEW'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('idx_kitchen_tickets_status').on(t.status, t.createdAt)]
);

export const tabItems = pgTable(
  'tab_items',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    tabId: uuid('tab_id')
      .references(() => tabs.id, { onDelete: 'cascade' })
      .notNull(),
    ticketId: uuid('ticket_id').references(() => kitchenTickets.id), // null until sent to kitchen
    menuItemId: uuid('menu_item_id')
      .references(() => menuItems.id)
      .notNull(),
    nameSnapshot: varchar('name_snapshot', { length: 128 }).notNull(),
    qty: integer('qty').notNull(), // SQL CHECK (qty > 0)
    unitPricePaise: paise('unit_price_paise').notNull(),
    discountPct: smallint('discount_pct').notNull().default(0),
    lineTotalPaise: paise('line_total_paise').notNull(),
    status: varchar('status', { length: 12 }).$type<TabItemStatus>().notNull().default('PENDING'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_tab_items_tab').on(t.tabId), index('idx_tab_items_ticket').on(t.ticketId)]
);

/**
 * A reservation of one bar table for a time window. BOOKED and SEATED rows hold the table; the
 * service refuses overlaps while holding a lock on the table row. COMPLETED, CANCELLED and NO_SHOW
 * rows stay as history and never block.
 */
export const barTableBookings = pgTable(
  'bar_table_bookings',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => barTables.id),
    guestName: varchar('guest_name', { length: 255 }).notNull(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    partySize: smallint('party_size').notNull().default(2),
    notes: varchar('notes', { length: 500 }),
    status: varchar('status', { length: 12 }).$type<TableBookingStatus>().notNull().default('BOOKED'),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_bar_table_bookings_table_time').on(t.tableId, t.startsAt),
    index('idx_bar_table_bookings_starts').on(t.startsAt),
    check('bar_table_bookings_range_chk', sql`${t.endsAt} > ${t.startsAt}`),
  ]
);
