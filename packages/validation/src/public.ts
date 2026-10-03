import { z } from 'zod';
import { UuidSchema, EmailSchema, IsoDateTimeSchema } from './common.js';
import { PaiseSchema, TimeOfDaySchema } from './domain-common.js';
import { BookingSchema } from './bookings.js';
import { PhoneSchema } from './members.js';

/** GET /public/club */
/** PUT /club/profile: the public details of the club. Any subset; at least one field. */
export const UpdateClubProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    tagline: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(32).optional(),
    address: z.string().trim().max(300).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), { message: 'Provide at least one field to change', path: ['name'] });
export type UpdateClubProfileRequest = z.infer<typeof UpdateClubProfileRequestSchema>;

export const ClubProfileSchema = z.object({ name: z.string(), tagline: z.string(), phone: z.string(), address: z.string() });
export type ClubProfile = z.infer<typeof ClubProfileSchema>;

export const PublicClubSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  phone: z.string(),
  address: z.string(),
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
