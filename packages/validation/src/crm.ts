import { z } from 'zod';
import { UuidSchema, EmailSchema, IsoDateTimeSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import { DateOnlySchema, PaiseSchema, PaymentMethodSchema, PaymentReceiptSchema, PersonRefSchema, PlanRefSchema } from './domain-common.js';
import { InvoiceSchema } from './finance.js';
import { MemberSchema, PhoneSchema } from './members.js';

export const LeadSourceEnum = z.enum(['WEBSITE_ENQUIRY', 'WEBSITE_TRIAL', 'WALK_IN', 'PHONE', 'REFERRAL']);
export type LeadSource = z.infer<typeof LeadSourceEnum>;

export const LeadStatusEnum = z.enum(['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST']);
export type LeadStatus = z.infer<typeof LeadStatusEnum>;

export const LeadSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: LeadSourceEnum,
  status: LeadStatusEnum,
  interestedPlan: PlanRefSchema.nullable(),
  message: z.string().nullable(),
  assignedTo: PersonRefSchema.nullable(),
  nextFollowUpAt: NullableIsoDateTimeOutSchema,
  memberId: UuidSchema.nullable(),
  createdAt: IsoDateTimeOutSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

/** GET /crm/leads items: a Lead plus `quoteCount`. */
export const LeadListItemSchema = LeadSchema.extend({
  quoteCount: z.number().int().min(0),
});
export type LeadListItem = z.infer<typeof LeadListItemSchema>;
export const LeadPageSchema = createPaginatedResponseSchema(LeadListItemSchema);

export const QuoteStatusEnum = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export type QuoteStatus = z.infer<typeof QuoteStatusEnum>;

export const QuoteSchema = z.object({
  id: UuidSchema,
  leadId: UuidSchema,
  plan: PlanRefSchema,
  amountPaise: PaiseSchema,
  validUntil: DateOnlySchema,
  status: QuoteStatusEnum,
  notes: z.string().nullable(),
  createdAt: IsoDateTimeOutSchema,
});
export type Quote = z.infer<typeof QuoteSchema>;

export const LeadActivitySchema = z.object({
  id: UuidSchema,
  type: z.string(),
  body: z.string().nullable(),
  actor: PersonRefSchema.nullable(),
  createdAt: IsoDateTimeOutSchema,
});
export type LeadActivity = z.infer<typeof LeadActivitySchema>;

/** GET /crm/leads/:id */
export const LeadDetailSchema = z.object({
  lead: LeadSchema,
  activities: z.array(LeadActivitySchema),
  quotes: z.array(QuoteSchema),
});
export type LeadDetail = z.infer<typeof LeadDetailSchema>;

/** GET /crm/leads */
export const LeadListQuerySchema = PaginationQuerySchema.extend({
  status: LeadStatusEnum.optional(),
  source: LeadSourceEnum.optional(),
  assignedTo: UuidSchema.optional(),
  dueToday: z.enum(['true', 'false']).optional(),
  q: z.string().trim().optional(),
});
export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

/** GET /crm/summary */
export const CrmSummarySchema = z.object({
  byStatus: z.object({
    NEW: z.number().int().min(0),
    CONTACTED: z.number().int().min(0),
    QUOTED: z.number().int().min(0),
    WON: z.number().int().min(0),
    LOST: z.number().int().min(0),
  }),
  dueToday: z.number().int().min(0),
  overdue: z.number().int().min(0),
  conversionRatePct: z.number().min(0).max(100),
});
export type CrmSummary = z.infer<typeof CrmSummarySchema>;

/** POST /crm/leads */
export const CreateLeadRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: PhoneSchema.optional(),
    email: EmailSchema.optional(),
    source: z.enum(['WALK_IN', 'PHONE', 'REFERRAL']),
    interestedPlanId: UuidSchema.optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Boolean(v.phone) || Boolean(v.email), {
    message: 'Provide a phone or an email',
    path: ['phone'],
  });
export type CreateLeadRequest = z.infer<typeof CreateLeadRequestSchema>;

/** PATCH /crm/leads/:id. LOST requires lostReason; WON only through convert. */
export const UpdateLeadRequestSchema = z
  .object({
    status: z.enum(['NEW', 'CONTACTED', 'QUOTED', 'LOST']).optional(),
    assignedTo: UuidSchema.nullable().optional(),
    nextFollowUpAt: IsoDateTimeSchema.nullable().optional(),
    lostReason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.status !== 'LOST' || Boolean(v.lostReason), {
    message: 'lostReason is required when marking a lead LOST',
    path: ['lostReason'],
  });
export type UpdateLeadRequest = z.infer<typeof UpdateLeadRequestSchema>;

/** POST /crm/leads/:id/activities */
export const CreateLeadActivityRequestSchema = z.object({
  type: z.enum(['NOTE', 'CALL', 'EMAIL']),
  body: z.string().trim().min(1).max(4000),
});
export type CreateLeadActivityRequest = z.infer<typeof CreateLeadActivityRequestSchema>;

/** POST /crm/leads/:id/quotes */
export const CreateQuoteRequestSchema = z.object({
  planId: UuidSchema,
  amountPaise: z.number().int().min(0).optional(),
  validUntil: DateOnlySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequestSchema>;

/** PATCH /crm/quotes/:id */
export const UpdateQuoteRequestSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
});
export type UpdateQuoteRequest = z.infer<typeof UpdateQuoteRequestSchema>;

/** POST /crm/leads/:id/convert */
export const ConvertLeadRequestSchema = z.object({
  planId: UuidSchema,
  quoteId: UuidSchema.optional(),
  startsOn: DateOnlySchema.optional(),
  paymentMethod: PaymentMethodSchema,
  dateOfBirth: DateOnlySchema.optional(),
  phone: PhoneSchema.optional(),
});
export type ConvertLeadRequest = z.infer<typeof ConvertLeadRequestSchema>;

export const ConvertLeadResponseSchema = z.object({
  lead: LeadSchema,
  member: MemberSchema,
  invoice: InvoiceSchema,
  payment: PaymentReceiptSchema,
});
export type ConvertLeadResponse = z.infer<typeof ConvertLeadResponseSchema>;
