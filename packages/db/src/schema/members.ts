import {
  pgTable,
  varchar,
  text,
  uuid,
  smallint,
  boolean,
  date,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';
import { pk, tstz, createdAt, updatedAt, paise } from './_columns.js';

export type MembershipStatusColumn = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REPLACED';
export type MembershipEventType =
  | 'CREATED'
  | 'RENEWED'
  | 'UPGRADED'
  | 'DOWNGRADE_SCHEDULED'
  | 'DOWNGRADED'
  | 'CANCEL_SCHEDULED'
  | 'CANCELLED'
  | 'EXPIRED';
export type ReminderKind = 'T30' | 'T7' | 'T1' | 'EXPIRED';

/** Tiers and entitlements. Edited by the Owner; never hard-coded. */
export const plans = pgTable('plans', {
  id: pk(),
  code: varchar('code', { length: 32 }).notNull().unique(), // GOLD | SILVER | JUNIOR
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  monthlyFeePaise: paise('monthly_fee_paise').notNull(),
  courtDiscountPct: smallint('court_discount_pct').notNull().default(0), // 100 = free play
  shopDiscountPct: smallint('shop_discount_pct').notNull().default(0),
  barDiscountPct: smallint('bar_discount_pct').notNull().default(0),
  maxBookingsPerDay: smallint('max_bookings_per_day').notNull().default(2),
  bookingHorizonDays: smallint('booking_horizon_days').notNull().default(7),
  minAge: smallint('min_age'),
  maxAge: smallint('max_age'), // JUNIOR: 17
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
// SQL CHECKs (0003): discounts between 0 and 100; monthly_fee_paise >= 0; max_bookings_per_day >= 1.

/** Club member profile. user_id is set only when the member has a login. */
export const members = pgTable(
  'members',
  {
    id: pk(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .unique(),
    memberCode: varchar('member_code', { length: 16 }).notNull().unique(), // CC-000123 from member_code_seq
    fullName: varchar('full_name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    email: varchar('email', { length: 255 }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    photoKey: varchar('photo_key', { length: 255 }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_members_phone').on(t.phone),
    index('idx_members_full_name').on(t.fullName),
    index('idx_members_email').on(t.email),
  ]
);

/** One row per membership term. */
export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    memberId: uuid('member_id')
      .references(() => members.id, { onDelete: 'cascade' })
      .notNull(),
    planId: uuid('plan_id')
      .references(() => plans.id)
      .notNull(),
    status: varchar('status', { length: 16 })
      .$type<MembershipStatusColumn>()
      .notNull()
      .default('ACTIVE'),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    pendingPlanId: uuid('pending_plan_id').references(() => plans.id), // scheduled downgrade
    invoiceId: uuid('invoice_id'), // FK added in SQL (0003) to avoid a circular import with finance.ts
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_memberships_one_active')
      .on(t.memberId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('idx_memberships_member').on(t.memberId),
    index('idx_memberships_ends_on').on(t.endsOn, t.status),
  ]
);

export const membershipEvents = pgTable(
  'membership_events',
  {
    id: pk(),
    membershipId: uuid('membership_id')
      .references(() => memberships.id, { onDelete: 'cascade' })
      .notNull(),
    memberId: uuid('member_id')
      .references(() => members.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 32 }).$type<MembershipEventType>().notNull(),
    fromPlanId: uuid('from_plan_id').references(() => plans.id),
    toPlanId: uuid('to_plan_id').references(() => plans.id),
    note: text('note'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_membership_events_member').on(t.memberId, t.createdAt)]
);

/** Idempotent reminders: (membership, kind) can only be created once. */
export const membershipReminders = pgTable(
  'membership_reminders',
  {
    membershipId: uuid('membership_id')
      .references(() => memberships.id, { onDelete: 'cascade' })
      .notNull(),
    kind: varchar('kind', { length: 16 }).$type<ReminderKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.kind] })]
);

export const memberCheckins = pgTable(
  'member_checkins',
  {
    id: pk(),
    memberId: uuid('member_id')
      .references(() => members.id, { onDelete: 'cascade' })
      .notNull(),
    checkedInAt: tstz('checked_in_at').defaultNow().notNull(),
    checkedInBy: uuid('checked_in_by').references(() => users.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id'), // FK added in SQL (0003)
  },
  (t) => [index('idx_member_checkins_member').on(t.memberId, t.checkedInAt)]
);

export type Plan = typeof plans.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
