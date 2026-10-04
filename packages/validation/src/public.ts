import { z } from 'zod';
import { UuidSchema, EmailSchema, IsoDateTimeSchema, IsoDateTimeOutSchema } from './common.js';
import { PaiseSchema, TimeOfDaySchema } from './domain-common.js';
import { BookingSchema } from './bookings.js';
import { ImageRefSchema } from './uploads.js';
import { PhoneSchema } from './members.js';

/** GET /public/club */
/** PUT /club/profile: the public details of the club. Any subset; at least one field. */
export const UpdateClubProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    tagline: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(32).optional(),
    address: z.string().trim().max(300).optional(),
    logoUrl: ImageRefSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), { message: 'Provide at least one field to change', path: ['name'] });
export type UpdateClubProfileRequest = z.infer<typeof UpdateClubProfileRequestSchema>;

export const ClubProfileSchema = z.object({ name: z.string(), tagline: z.string(), phone: z.string(), address: z.string(), logoUrl: z.string().nullable().optional() });
export type ClubProfile = z.infer<typeof ClubProfileSchema>;

export const PublicClubSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  phone: z.string(),
  address: z.string(),
  logoUrl: z.string().nullable().optional(),
  hours: z.object({ open: TimeOfDaySchema, close: TimeOfDaySchema }),
  timezone: z.string(),
  courtTypes: z.array(
    z.object({
      id: UuidSchema,
      code: z.string(),
      name: z.string(),
      baseRatePaise: PaiseSchema,
      trialFeePaise: PaiseSchema,
      courtCount: z.number().int().min(0),
    }),
  ),
  socialPlay: z.object({
    weekday: z.number().int().min(0).max(6),
    startsTime: TimeOfDaySchema,
    endsTime: TimeOfDaySchema,
  }),
});
export type PublicClub = z.infer<typeof PublicClubSchema>;

/** POST /public/enquiries: phone or email required. */
export const CreateEnquiryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: PhoneSchema.optional(),
    email: EmailSchema.optional(),
    message: z.string().trim().min(1).max(2000),
    interestedPlanId: UuidSchema.optional(),
  })
  .refine((v) => Boolean(v.phone) || Boolean(v.email), {
    message: 'Provide a phone or an email',
    path: ['phone'],
  });
export type CreateEnquiryRequest = z.infer<typeof CreateEnquiryRequestSchema>;

export const CreateEnquiryResponseSchema = z.object({
  id: UuidSchema,
  message: z.string(),
});
export type CreateEnquiryResponse = z.infer<typeof CreateEnquiryResponseSchema>;

/** POST /public/trial-bookings */
export const CreateTrialBookingRequestSchema = z.object({
  courtId: UuidSchema,
  startsAt: IsoDateTimeSchema,
  name: z.string().trim().min(1).max(200),
  phone: PhoneSchema,
  email: EmailSchema.optional(),
});
export type CreateTrialBookingRequest = z.infer<typeof CreateTrialBookingRequestSchema>;

export const CreateTrialBookingResponseSchema = z.object({
  booking: BookingSchema,
  leadId: UuidSchema,
  message: z.string(),
});
export type CreateTrialBookingResponse = z.infer<typeof CreateTrialBookingResponseSchema>;

/** Share of the price a guest pays up-front when they choose cash. */
export const PROMISE_FEE_PCT = 20;

/** The promise fee for a price: 20% rounded up to a whole paisa, at least 1 and never above the price. */
export const promiseFeePaise = (pricePaise: number): number =>
  Math.min(pricePaise, Math.max(1, Math.ceil((pricePaise * PROMISE_FEE_PCT) / 100)));

/** The payment choices on the checkout dialog. UPI and card pay in full; cash pays the promise fee. */
export const CheckoutMethodEnum = z.enum(['UPI', 'CARD', 'CASH']);
export type CheckoutMethod = z.infer<typeof CheckoutMethodEnum>;

/** POST /public/bookings: a guest books and pays in one step. */
export const CreatePublicBookingRequestSchema = z.object({
  courtId: UuidSchema,
  startsAt: IsoDateTimeSchema,
  name: z.string().trim().min(1).max(200),
  phone: PhoneSchema,
  email: EmailSchema.optional(),
  method: CheckoutMethodEnum,
});
export type CreatePublicBookingRequest = z.infer<typeof CreatePublicBookingRequestSchema>;

export const CreatePublicBookingResponseSchema = z.object({
  booking: BookingSchema,
  paidPaise: z.number().int().min(0),
  duePaise: z.number().int().min(0),
  message: z.string(),
});
export type CreatePublicBookingResponse = z.infer<typeof CreatePublicBookingResponseSchema>;

/** The state of a guest checkout. A PENDING intent holds the slot until `expiresAt`. */
export const PaymentIntentStatusEnum = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED']);
export type PaymentIntentStatusValue = z.infer<typeof PaymentIntentStatusEnum>;

/** POST /public/bookings/holds: same details as a direct booking; the amount is always server-computed. */
export const CreateBookingHoldRequestSchema = CreatePublicBookingRequestSchema;
export type CreateBookingHoldRequest = z.infer<typeof CreateBookingHoldRequestSchema>;

export const PaymentIntentSchema = z.object({
  id: UuidSchema,
  status: PaymentIntentStatusEnum,
  method: CheckoutMethodEnum,
  /** What must be paid now: the full price, or the promise fee for cash. */
  amountPaise: z.number().int().positive(),
  totalPaise: z.number().int().positive(),
  /** What remains to be paid at the venue once this intent succeeds. */
  duePaise: z.number().int().min(0),
  expiresAt: IsoDateTimeOutSchema,
  /** Present once the payment succeeded and the booking exists. */
  booking: BookingSchema.nullable(),
});
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;

/**
 * POST /public/payments/webhook, sent by the gateway. The `x-signature` header is the hex
 * HMAC-SHA256 of `${intentId}.${event}.${amountPaise}.${reference}` under PAYMENT_WEBHOOK_SECRET.
 */
export const PaymentWebhookRequestSchema = z.object({
  intentId: UuidSchema,
  event: z.enum(['payment.succeeded', 'payment.failed']),
  amountPaise: z.number().int().min(0),
  reference: z.string().trim().min(1).max(128),
});
export type PaymentWebhookRequest = z.infer<typeof PaymentWebhookRequestSchema>;

export const PaymentWebhookResponseSchema = z.object({
  intentId: UuidSchema,
  status: PaymentIntentStatusEnum,
  /** True when this delivery repeated one that was already applied. */
  duplicate: z.boolean(),
});
export type PaymentWebhookResponse = z.infer<typeof PaymentWebhookResponseSchema>;
