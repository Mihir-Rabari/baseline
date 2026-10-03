import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, IsoDateTimeOutSchema, EmailSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import {
  DateOnlySchema,
  PaiseSchema,
  PctSchema,
  MemberRefSchema,
  PaymentMethodSchema,
  RefundSchema,
} from './domain-common.js';
import { PhoneSchema } from './members.js';

export const BookingKindEnum = z.enum(['STANDARD', 'SOCIAL', 'TRIAL']);
export type BookingKind = z.infer<typeof BookingKindEnum>;

export const BookingStatusEnum = z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export type BookingStatus = z.infer<typeof BookingStatusEnum>;

export const BookingChannelEnum = z.enum(['DESK', 'PHONE', 'ONLINE', 'WEBSITE_TRIAL']);
export type BookingChannel = z.infer<typeof BookingChannelEnum>;

export const BookingPaymentStatusEnum = z.enum(['UNPAID', 'PARTIAL', 'PAID', 'WAIVED', 'REFUNDED']);
export type BookingPaymentStatus = z.infer<typeof BookingPaymentStatusEnum>;

export const BookingGuestSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
});
export type BookingGuest = z.infer<typeof BookingGuestSchema>;

export const BookingSchema = z.object({
  id: UuidSchema,
  court: z.object({ id: UuidSchema, name: z.string(), type: z.string() }),
  kind: BookingKindEnum,
  member: MemberRefSchema.nullable(),
  guest: BookingGuestSchema.nullable(),
  startsAt: IsoDateTimeOutSchema,
  endsAt: IsoDateTimeOutSchema,
  bookingDate: DateOnlySchema,
  status: BookingStatusEnum,
  cancelledLate: z.boolean(),
  channel: BookingChannelEnum,
  basePricePaise: PaiseSchema,
  discountPct: PctSchema,
  pricePaise: PaiseSchema,
  paymentStatus: BookingPaymentStatusEnum,
  socialSessionId: UuidSchema.nullable(),
  createdAt: IsoDateTimeOutSchema,
});
export type Booking = z.infer<typeof BookingSchema>;

export const BookingPageSchema = createPaginatedResponseSchema(BookingSchema);
export type BookingPage = z.infer<typeof BookingPageSchema>;

const GuestRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: PhoneSchema,
  email: EmailSchema.optional(),
});

/** POST /bookings. FD/OWN must send exactly one of memberId or guest (checked server-side by role). */
export const CreateBookingRequestSchema = z
  .object({
    courtId: UuidSchema,
    startsAt: IsoDateTimeSchema,
    memberId: UuidSchema.optional(),
    guest: GuestRequestSchema.optional(),
    channel: z.enum(['DESK', 'PHONE', 'ONLINE']).optional(),
    payNow: z.object({ method: PaymentMethodSchema }).optional(),
  })
  .refine((v) => !(v.memberId && v.guest), {
    message: 'Provide memberId or guest, not both',
    path: ['guest'],
  });
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

/** POST /bookings/social/join */
export const JoinSocialRequestSchema = z
  .object({
    courtId: UuidSchema,
    startsAt: IsoDateTimeSchema,
    memberId: UuidSchema.optional(),
    guest: GuestRequestSchema.optional(),
  })
  .refine((v) => !(v.memberId && v.guest), {
    message: 'Provide memberId or guest, not both',
    path: ['guest'],
  });
export type JoinSocialRequest = z.infer<typeof JoinSocialRequestSchema>;

export const JoinSocialResponseSchema = BookingSchema.extend({
  socialSession: z.object({
    capacity: z.number().int().positive(),
    joined: z.number().int().min(0),
  }),
});
export type JoinSocialResponse = z.infer<typeof JoinSocialResponseSchema>;

/** GET /bookings (FD, OWN) */
export const BookingListQuerySchema = PaginationQuerySchema.extend({
  date: DateOnlySchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  courtId: UuidSchema.optional(),
  memberId: UuidSchema.optional(),
  status: BookingStatusEnum.optional(),
  kind: BookingKindEnum.optional(),
}).refine((v) => !v.date || (!v.from && !v.to), {
  message: 'Use either date or from+to, not both',
  path: ['date'],
}).refine((v) => !v.from || !v.to || v.to >= v.from, {
  message: 'to must not be before from',
  path: ['to'],
});
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;

/** GET /me/bookings */
export const MyBookingsQuerySchema = PaginationQuerySchema.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});
export type MyBookingsQuery = z.infer<typeof MyBookingsQuerySchema>;

/** POST /bookings/:id/cancel. `override` waives the cutoff and requires a reason. */
export const CancelBookingRequestSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
    override: z.boolean().optional(),
  })
  .refine((v) => !v.override || Boolean(v.reason && v.reason.length > 0), {
    message: 'A reason is required when overriding the cancellation cutoff',
    path: ['reason'],
  });
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;

export const CancelBookingResponseSchema = z.object({
  booking: BookingSchema,
  refund: RefundSchema.nullable(),
  quotaFreed: z.boolean(),
  late: z.boolean(),
});
export type CancelBookingResponse = z.infer<typeof CancelBookingResponseSchema>;

/** POST /bookings/:id/pay */
export const PayBookingRequestSchema = z.object({
  method: PaymentMethodSchema,
  reference: z.string().trim().max(100).optional(),
});
export type PayBookingRequest = z.infer<typeof PayBookingRequestSchema>;

export const PayBookingResponseSchema = z.object({
  booking: BookingSchema,
  payment: z.object({
    id: UuidSchema,
    amountPaise: PaiseSchema,
    method: PaymentMethodSchema,
    paidAt: IsoDateTimeOutSchema,
  }),
});
export type PayBookingResponse = z.infer<typeof PayBookingResponseSchema>;
