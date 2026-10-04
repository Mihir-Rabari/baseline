import {
  pgTable,
  varchar,
  text,
  uuid,
  smallint,
  boolean,
  date,
  time,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';
import { members } from './members.js';
import { pk, tstz, createdAt, updatedAt, paise } from './_columns.js';

export type BookingKind = 'STANDARD' | 'SOCIAL' | 'TRIAL';
export type BookingStatus = 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
/** PARTIAL: a cash booking that has paid its promise fee; the rest is due at the venue. */
export type BookingPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'REFUNDED';
export type BookingChannel = 'DESK' | 'PHONE' | 'ONLINE' | 'WEBSITE_TRIAL';
export type OccupancyKind = 'BOOKING' | 'SOCIAL' | 'MAINTENANCE';

/** Sports are data: TENNIS, PADEL, BADMINTON, CRICKET_NETS. */
export const courtTypes = pgTable('court_types', {
  id: pk(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 64 }).notNull(),
  baseRatePaise: paise('base_rate_paise').notNull(), // walk-in price for 1 hour
  socialFeePaise: paise('social_fee_paise').notNull(), // per head, Friday social play
  trialFeePaise: paise('trial_fee_paise').notNull(),
  socialCapacity: smallint('social_capacity').notNull().default(8),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const courts = pgTable(
  'courts',
  {
    id: pk(),
    courtTypeId: uuid('court_type_id')
      .references(() => courtTypes.id)
      .notNull(),
    name: varchar('name', { length: 64 }).notNull().unique(), // "Tennis Court 1"
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    imageUrl: varchar('image_url', { length: 512 }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_courts_type').on(t.courtTypeId)]
);

/** Weekday uses ISO numbering: 1 = Monday ... 7 = Sunday (Friday = 5). */
export const socialWindows = pgTable('social_windows', {
  id: pk(),
  weekday: smallint('weekday').notNull(),
  startsTime: time('starts_time').notNull(), // '18:00'
  endsTime: time('ends_time').notNull(), // '22:00'
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const socialSessions = pgTable(
  'social_sessions',
  {
    id: pk(),
    courtId: uuid('court_id')
      .references(() => courts.id)
      .notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    capacity: smallint('capacity').notNull(),
    status: varchar('status', { length: 16 })
      .$type<'OPEN' | 'CANCELLED'>()
      .notNull()
      .default('OPEN'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('uq_social_sessions_court_start').on(t.courtId, t.startsAt)]
);

export const bookings = pgTable(
  'bookings',
  {
    id: pk(),
    courtId: uuid('court_id')
      .references(() => courts.id)
      .notNull(),
    kind: varchar('kind', { length: 16 }).$type<BookingKind>().notNull().default('STANDARD'),
    memberId: uuid('member_id').references(() => members.id),
    guestName: varchar('guest_name', { length: 255 }),
    guestPhone: varchar('guest_phone', { length: 20 }),
    guestEmail: varchar('guest_email', { length: 255 }),
    socialSessionId: uuid('social_session_id').references(() => socialSessions.id),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    bookingDate: date('booking_date', { mode: 'string' }).notNull(), // club-local date of starts_at
    status: varchar('status', { length: 16 }).$type<BookingStatus>().notNull().default('CONFIRMED'),
    cancelledAt: tstz('cancelled_at'),
    cancelledLate: boolean('cancelled_late').notNull().default(false),
    cancelReason: text('cancel_reason'),
    basePricePaise: paise('base_price_paise').notNull(), // list price at booking time
    discountPct: smallint('discount_pct').notNull().default(0),
    pricePaise: paise('price_paise').notNull(), // snapshot: what this booking costs
    paymentStatus: varchar('payment_status', { length: 16 })
      .$type<BookingPaymentStatus>()
      .notNull()
      .default('UNPAID'),
    channel: varchar('channel', { length: 20 }).$type<BookingChannel>().notNull().default('DESK'),
    leadId: uuid('lead_id'), // FK added in SQL (0003)
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_bookings_court_start').on(t.courtId, t.startsAt),
    index('idx_bookings_member_date').on(t.memberId, t.bookingDate),
    index('idx_bookings_date_status').on(t.bookingDate, t.status),
    index('idx_bookings_guest_phone').on(t.guestPhone),
    uniqueIndex('uq_bookings_social_member')
      .on(t.socialSessionId, t.memberId)
      .where(sql`${t.status} <> 'CANCELLED' AND ${t.memberId} IS NOT NULL`),
    uniqueIndex('uq_bookings_trial_phone')
      .on(t.guestPhone)
      .where(sql`${t.kind} = 'TRIAL' AND ${t.status} <> 'CANCELLED'`),
  ]
);
// SQL (0003): CHECK (member_id IS NOT NULL OR guest_name IS NOT NULL); CHECK (ends_at > starts_at);
// EXCLUDE bookings_member_no_overlap; FK bookings.lead_id -> leads(id).

/** The single source of truth for "is this court busy". EXCLUDE constraint lives in SQL (0003). */
export const courtOccupancies = pgTable(
  'court_occupancies',
  {
    id: pk(),
    courtId: uuid('court_id')
      .references(() => courts.id)
      .notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    kind: varchar('kind', { length: 16 }).$type<OccupancyKind>().notNull(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'cascade' })
      .unique(),
    socialSessionId: uuid('social_session_id')
      .references(() => socialSessions.id, { onDelete: 'cascade' })
      .unique(),
    reason: text('reason'), // MAINTENANCE
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_court_occupancies_court_start').on(t.courtId, t.startsAt)]
);
// SQL (0003): EXCLUDE court_occupancies_no_overlap; CHECK court_occupancies_shape.
