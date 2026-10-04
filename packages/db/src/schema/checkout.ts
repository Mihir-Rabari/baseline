import { pgTable, varchar, uuid, smallint, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { courts, courtOccupancies, bookings } from './courts.js';
import { pk, tstz, createdAt, updatedAt, paise } from './_columns.js';
import type { PaymentMethod } from './finance.js';

export type PaymentIntentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';

/**
 * A guest checkout in flight (#67). While PENDING it holds the slot through `occupancyId`; the
 * booking row only exists once the gateway confirms the payment. `amountPaise` is what the
 * server expects to be paid now (the full price, or the 20% promise fee for cash), so a webhook
 * can never confirm a tampered amount. Unpaid holds are released when `expiresAt` passes.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: pk(),
    status: varchar('status', { length: 12 }).$type<PaymentIntentStatus>().notNull().default('PENDING'),
    method: varchar('method', { length: 8 }).$type<PaymentMethod>().notNull(),
    amountPaise: paise('amount_paise').notNull(),
    totalPaise: paise('total_paise').notNull(),
    courtId: uuid('court_id')
      .references(() => courts.id)
      .notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    basePricePaise: paise('base_price_paise').notNull(),
    discountPct: smallint('discount_pct').notNull().default(0),
    guestName: varchar('guest_name', { length: 255 }).notNull(),
    guestPhone: varchar('guest_phone', { length: 20 }).notNull(),
    guestEmail: varchar('guest_email', { length: 255 }),
    occupancyId: uuid('occupancy_id').references(() => courtOccupancies.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    /** Gateway transaction id; unique so a replayed webhook can never record a second payment. */
    reference: varchar('reference', { length: 128 }),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_payment_intents_status_expiry').on(t.status, t.expiresAt),
    uniqueIndex('uq_payment_intents_reference').on(t.reference).where(sql`${t.reference} IS NOT NULL`),
  ]
);
