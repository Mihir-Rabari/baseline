import { pgTable, varchar, text, uuid, integer, smallint, date, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { members } from './members.js';
import { pk, tstz, createdAt, paise } from './_columns.js';

export type PaymentSource = 'COURT' | 'SHOP' | 'BAR' | 'MEMBERSHIP' | 'INVOICE';
export type PaymentMethod = 'CASH' | 'CARD' | 'UPI';
export type PaymentKind = 'PAYMENT' | 'REFUND';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'VOID';

/** THE ledger. Every rupee in the owner dashboard comes from here. */
export const payments = pgTable(
  'payments',
  {
    id: pk(),
    source: varchar('source', { length: 16 }).$type<PaymentSource>().notNull(),
    sourceId: uuid('source_id'), // booking, order, tab, membership or invoice id
    kind: varchar('kind', { length: 8 }).$type<PaymentKind>().notNull().default('PAYMENT'),
    amountPaise: paise('amount_paise').notNull(), // negative for REFUND; SQL CHECK (amount_paise <> 0)
    method: varchar('method', { length: 8 }).$type<PaymentMethod>().notNull(),
    memberId: uuid('member_id').references(() => members.id),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id'), // FK added in SQL (0003)
    reference: varchar('reference', { length: 128 }), // UPI transaction id, card slip
    paidAt: tstz('paid_at').defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_payments_paid_at').on(t.paidAt),
    index('idx_payments_source_paid_at').on(t.source, t.paidAt),
    index('idx_payments_method_paid_at').on(t.method, t.paidAt),
    index('idx_payments_source_ref').on(t.source, t.sourceId),
  ]
);

export const businessClients = pgTable('business_clients', {
  id: pk(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  contactName: varchar('contact_name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  gstin: varchar('gstin', { length: 20 }),
  billingAddress: text('billing_address'),
  createdAt: createdAt(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    invoiceNumber: varchar('invoice_number', { length: 24 }).notNull().unique(), // INV-2026-0001 via invoice_number_seq
    memberId: uuid('member_id').references(() => members.id),
    businessClientId: uuid('business_client_id').references(() => businessClients.id),
    status: varchar('status', { length: 8 }).$type<InvoiceStatus>().notNull().default('DRAFT'),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    subtotalPaise: paise('subtotal_paise').notNull(),
    taxPaise: paise('tax_paise').notNull(), // portion of the inclusive total, from tax.rates
    totalPaise: paise('total_paise').notNull(),
    notes: text('notes'),
    sentAt: tstz('sent_at'),
    paidAt: tstz('paid_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_invoices_status_due').on(t.status, t.dueDate),
    index('idx_invoices_member').on(t.memberId),
    index('idx_invoices_client').on(t.businessClientId),
  ]
);
// SQL (0003): CHECK ((member_id IS NULL) <> (business_client_id IS NULL)); FK memberships.invoice_id -> invoices(id).

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    /** Order of the line on the invoice (migration 0006); ids are random, so they cannot carry order. */
    position: smallint('position').notNull().default(0),
    description: varchar('description', { length: 255 }).notNull(),
    qty: integer('qty').notNull().default(1),
    unitPricePaise: paise('unit_price_paise').notNull(),
    lineTotalPaise: paise('line_total_paise').notNull(),
  },
  (t) => [index('idx_invoice_lines_invoice').on(t.invoiceId)]
);

/** Read-only dashboard share links. Only the SHA-256 hash is stored, like session tokens. */
export const reportShares = pgTable('report_shares', {
  id: pk(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  defaultRange: varchar('default_range', { length: 8 })
    .$type<'today' | 'week' | 'month'>()
    .notNull()
    .default('month'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: tstz('expires_at').notNull(),
  revokedAt: tstz('revoked_at'),
  createdAt: createdAt(),
});
