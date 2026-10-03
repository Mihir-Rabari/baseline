import { pgTable, varchar, text, uuid, date, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { members, plans } from './members.js';
import { pk, tstz, createdAt, updatedAt, paise } from './_columns.js';

export type LeadSource = 'WEBSITE_ENQUIRY' | 'WEBSITE_TRIAL' | 'WALK_IN' | 'PHONE' | 'REFERRAL';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUOTED' | 'WON' | 'LOST';
export type LeadActivityType = 'NOTE' | 'CALL' | 'EMAIL' | 'STATUS_CHANGE' | 'QUOTE_SENT' | 'TRIAL_BOOKED' | 'CONVERTED';
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export const leads = pgTable(
  'leads',
  {
    id: pk(),
    name: varchar('name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    source: varchar('source', { length: 20 }).$type<LeadSource>().notNull(),
    interestedPlanId: uuid('interested_plan_id').references(() => plans.id),
    message: text('message'),
    status: varchar('status', { length: 12 }).$type<LeadStatus>().notNull().default('NEW'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    nextFollowUpAt: tstz('next_follow_up_at'),
    lostReason: text('lost_reason'),
    memberId: uuid('member_id').references(() => members.id).unique(), // set on conversion
    convertedAt: tstz('converted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_leads_status').on(t.status),
    index('idx_leads_follow_up').on(t.nextFollowUpAt),
    index('idx_leads_phone').on(t.phone),
  ]
);
// SQL (0003): CHECK (phone IS NOT NULL OR email IS NOT NULL).

export const leadActivities = pgTable(
  'lead_activities',
  {
    id: pk(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
    type: varchar('type', { length: 16 }).$type<LeadActivityType>().notNull(),
    body: text('body'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_lead_activities_lead').on(t.leadId, t.createdAt)]
);

export const quotes = pgTable(
  'quotes',
  {
    id: pk(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
    planId: uuid('plan_id').references(() => plans.id).notNull(),
    amountPaise: paise('amount_paise').notNull(),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 12 }).$type<QuoteStatus>().notNull().default('DRAFT'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_quotes_lead').on(t.leadId)]
);
