import { z } from 'zod';
import { UuidSchema, EmailSchema, IsoDateTimeOutSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import {
  DateOnlySchema,
  PctSchema,
  PaiseSchema,
  PaymentMethodSchema,
  PaymentReceiptSchema,
  PlanRefSchema,
} from './domain-common.js';
import { InvoiceSchema } from './finance.js';

export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Invalid phone number');

export const MembershipStatusEnum = z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED', 'REPLACED']);
export type MembershipStatus = z.infer<typeof MembershipStatusEnum>;

export const ExpiryStateEnum = z.enum(['OK', 'EXPIRING_SOON', 'EXPIRED']);
export type ExpiryState = z.infer<typeof ExpiryStateEnum>;

export const MembershipSchema = z.object({
  id: UuidSchema,
  status: MembershipStatusEnum,
  plan: PlanRefSchema,
  startsOn: DateOnlySchema,
  endsOn: DateOnlySchema,
  daysLeft: z.number().int(),
  expiryState: ExpiryStateEnum,
  cancelAtPeriodEnd: z.boolean(),
  pendingPlan: z.object({ code: z.string(), name: z.string() }).nullable(),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const EntitlementsSchema = z.object({
  courtDiscountPct: PctSchema,
  shopDiscountPct: PctSchema,
  barDiscountPct: PctSchema,
  maxBookingsPerDay: z.number().int().min(0),
  bookingHorizonDays: z.number().int().min(0),
});
export type Entitlements = z.infer<typeof EntitlementsSchema>;

export const MemberSchema = z.object({
  id: UuidSchema,
  memberCode: z.string(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  dateOfBirth: DateOnlySchema.nullable(),
  photoUrl: z.string().nullable(),
  hasLogin: z.boolean(),
  membership: MembershipSchema.nullable(),
  entitlements: EntitlementsSchema,
  createdAt: IsoDateTimeOutSchema,
});
export type Member = z.infer<typeof MemberSchema>;

export const MemberPageSchema = createPaginatedResponseSchema(MemberSchema);
export type MemberPage = z.infer<typeof MemberPageSchema>;

/** GET /members */
export const MemberListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(2).optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'EXPIRING_SOON', 'NONE']).optional(),
  planCode: z.string().trim().min(1).optional(),
});
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;

/** GET /members/lookup */
export const MemberLookupQuerySchema = z.object({
  q: z.string().trim().min(2),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type MemberLookupQuery = z.infer<typeof MemberLookupQuerySchema>;

export const MemberLookupItemSchema = z.object({
  id: UuidSchema,
  memberCode: z.string(),
  fullName: z.string(),
  phone: z.string(),
  planCode: z.string().nullable(),
  expiryState: ExpiryStateEnum.or(z.literal('NONE')),
  barDiscountPct: PctSchema,
  shopDiscountPct: PctSchema,
});
export type MemberLookupItem = z.infer<typeof MemberLookupItemSchema>;
export const MemberLookupResponseSchema = z.array(MemberLookupItemSchema);

/** POST /members */
export const CreateMemberRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: PhoneSchema,
  email: EmailSchema.optional(),
  dateOfBirth: DateOnlySchema.optional(),
  planId: UuidSchema,
  paymentMethod: PaymentMethodSchema,
  startsOn: DateOnlySchema.optional(),
});
export type CreateMemberRequest = z.infer<typeof CreateMemberRequestSchema>;

export const CreateMemberResponseSchema = z.object({
  member: MemberSchema,
  invoice: InvoiceSchema,
  payment: PaymentReceiptSchema,
});
export type CreateMemberResponse = z.infer<typeof CreateMemberResponseSchema>;

/** PATCH /members/:id */
export const UpdateMemberRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  phone: PhoneSchema.optional(),
  email: EmailSchema.optional(),
  dateOfBirth: DateOnlySchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;

/** GET /members/:id/timeline */
export const MemberTimelineQuerySchema = PaginationQuerySchema.pick({ page: true, limit: true });
export type MemberTimelineQuery = z.infer<typeof MemberTimelineQuerySchema>;

export const MemberTimelineTypeEnum = z.enum(['CHECKIN', 'BOOKING', 'ORDER', 'TAB', 'INVOICE', 'MEMBERSHIP']);
export const MemberTimelineItemSchema = z.object({
  type: MemberTimelineTypeEnum,
  at: IsoDateTimeOutSchema,
  title: z.string(),
  detail: z.string().nullable().optional(),
  amountPaise: PaiseSchema.optional(),
  link: z.string().optional(),
});
export type MemberTimelineItem = z.infer<typeof MemberTimelineItemSchema>;
export const MemberTimelinePageSchema = createPaginatedResponseSchema(MemberTimelineItemSchema);

/** POST /members/:id/checkin */
export const CheckinRequestSchema = z.object({
  bookingId: UuidSchema.optional(),
});
export type CheckinRequest = z.infer<typeof CheckinRequestSchema>;

export const CheckinResponseSchema = z.object({
  id: UuidSchema,
  checkedInAt: IsoDateTimeOutSchema,
  member: MemberSchema,
});
export type CheckinResponse = z.infer<typeof CheckinResponseSchema>;

/** POST /members/:id/membership/renew */
export const RenewMembershipRequestSchema = z.object({
  paymentMethod: PaymentMethodSchema,
});
export type RenewMembershipRequest = z.infer<typeof RenewMembershipRequestSchema>;

export const RenewMembershipResponseSchema = z.object({
  member: MemberSchema,
  invoice: InvoiceSchema,
  payment: PaymentReceiptSchema,
});
export type RenewMembershipResponse = z.infer<typeof RenewMembershipResponseSchema>;

/** POST /members/:id/membership/change-plan */
export const ChangePlanRequestSchema = z.object({
  planId: UuidSchema,
  paymentMethod: PaymentMethodSchema.optional(),
});
export type ChangePlanRequest = z.infer<typeof ChangePlanRequestSchema>;

export const ChangePlanUpgradeResponseSchema = z.object({
  member: MemberSchema,
  topUpInvoice: InvoiceSchema.nullable(),
  effective: z.literal('NOW'),
});
export const ChangePlanDowngradeResponseSchema = z.object({
  member: MemberSchema,
  effective: z.literal('AT_RENEWAL'),
  effectiveOn: DateOnlySchema,
});
export const ChangePlanResponseSchema = z.union([
  ChangePlanUpgradeResponseSchema,
  ChangePlanDowngradeResponseSchema,
]);
export type ChangePlanResponse = z.infer<typeof ChangePlanResponseSchema>;

/** POST /members/:id/membership/cancel */
export const CancelMembershipRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelMembershipRequest = z.infer<typeof CancelMembershipRequestSchema>;

/** PUT /me/member */
export const UpsertMyMemberRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: PhoneSchema,
  dateOfBirth: DateOnlySchema.optional(),
});
export type UpsertMyMemberRequest = z.infer<typeof UpsertMyMemberRequestSchema>;
