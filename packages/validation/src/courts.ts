import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, IsoDateTimeOutSchema } from './common.js';
import { ImageRefSchema } from './uploads.js';
import { DateOnlySchema, NonNegativePaiseSchema, PaiseSchema, PositivePaiseSchema, TimeOfDaySchema } from './domain-common.js';

/** GET /courts */
export const CourtSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  type: z.string(),
  typeName: z.string(),
  baseRatePaise: PaiseSchema,
  socialCapacity: z.number().int().min(0).nullable(),
  isActive: z.boolean(),
  courtTypeId: UuidSchema.optional(),
  sortOrder: z.number().int().optional(),
  imageUrl: z.string().nullable().optional(),
});
export type Court = z.infer<typeof CourtSchema>;
export const CourtListSchema = z.array(CourtSchema);

// ---- Court management (owner) ----

/** GET /court-types: the sports a court can be assigned to. */
export const CourtTypeSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  baseRatePaise: PaiseSchema,
  socialFeePaise: PaiseSchema,
  trialFeePaise: PaiseSchema,
  socialCapacity: z.number().int().min(0),
  isActive: z.boolean(),
});
export type CourtType = z.infer<typeof CourtTypeSchema>;
export const CourtTypeListSchema = z.array(CourtTypeSchema);

/** POST /court-types: a new sport. `code` is permanent. */
export const CreateCourtTypeRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Use capital letters, digits and underscores'),
  name: z.string().trim().min(1).max(64),
  baseRatePaise: PositivePaiseSchema,
  socialFeePaise: NonNegativePaiseSchema.optional(),
  trialFeePaise: NonNegativePaiseSchema.optional(),
  socialCapacity: z.number().int().min(0).max(200).optional(),
  isActive: z.boolean().optional(),
});
export type CreateCourtTypeRequest = z.infer<typeof CreateCourtTypeRequestSchema>;

/** PUT /court-types/:id: any subset except the code. */
export const UpdateCourtTypeRequestSchema = CreateCourtTypeRequestSchema.omit({ code: true }).partial();
export type UpdateCourtTypeRequest = z.infer<typeof UpdateCourtTypeRequestSchema>;

/** POST /courts */
export const CreateCourtRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
  courtTypeId: UuidSchema,
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  imageUrl: ImageRefSchema.nullable().optional(),
});
export type CreateCourtRequest = z.infer<typeof CreateCourtRequestSchema>;

/** PUT /courts/:id: any subset. */
export const UpdateCourtRequestSchema = CreateCourtRequestSchema.partial();
export type UpdateCourtRequest = z.infer<typeof UpdateCourtRequestSchema>;

/** DELETE /courts/:id: a court with booking history is deactivated instead of deleted. */
export const DeleteCourtResponseSchema = z.object({
  deleted: z.boolean(),
  deactivated: z.boolean(),
});
export type DeleteCourtResponse = z.infer<typeof DeleteCourtResponseSchema>;

// ---- Availability (5.1) ----

/** GET /courts/availability and GET /public/availability */
export const AvailabilityQuerySchema = z.object({
  date: DateOnlySchema,
  courtTypeId: UuidSchema.optional(),
  memberId: UuidSchema.optional(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export const SlotStatusEnum = z.enum(['FREE', 'BOOKED', 'BLOCKED', 'SOCIAL_OPEN', 'SOCIAL_FULL', 'PAST']);
export type SlotStatus = z.infer<typeof SlotStatusEnum>;

export const CourtModeEnum = z.enum(['STANDARD', 'SOCIAL']);
export type CourtMode = z.infer<typeof CourtModeEnum>;

export const AvailabilitySlotSchema = z.object({
  startsAt: IsoDateTimeOutSchema,
  endsAt: IsoDateTimeOutSchema,
  status: SlotStatusEnum,
  pricePaise: PaiseSchema,
  // Staff only
  bookingId: UuidSchema.optional(),
  holder: z.string().optional(),
  // BLOCKED
  reason: z.string().optional(),
  // Social slots
  capacity: z.number().int().positive().optional(),
  spotsLeft: z.number().int().min(0).optional(),
  socialSessionId: UuidSchema.optional(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export const AvailabilityCourtSchema = z.object({
  courtId: UuidSchema,
  name: z.string(),
  type: z.string(),
  mode: CourtModeEnum,
  slots: z.array(AvailabilitySlotSchema),
});
export type AvailabilityCourt = z.infer<typeof AvailabilityCourtSchema>;

export const AvailabilitySchema = z.object({
  date: DateOnlySchema,
  timezone: z.string(),
  generatedAt: IsoDateTimeOutSchema,
  priceFor: z.object({
    type: z.string(),
    label: z.string(),
    memberId: UuidSchema.optional(),
  }),
  courts: z.array(AvailabilityCourtSchema),
  limits: z
    .object({
      usedToday: z.number().int().min(0),
      maxPerDay: z.number().int().min(0),
    })
    .optional(),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

// ---- Maintenance blocks (5.3) ----

const halfHourAligned = (v: string) => {
  const d = new Date(v);
  return d.getUTCMinutes() % 30 === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
};

/** POST /courts/blocks */
export const CreateCourtBlockRequestSchema = z
  .object({
    courtId: UuidSchema,
    startsAt: IsoDateTimeSchema.refine(halfHourAligned, 'Must be aligned to 30 minutes'),
    endsAt: IsoDateTimeSchema.refine(halfHourAligned, 'Must be aligned to 30 minutes'),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type CreateCourtBlockRequest = z.infer<typeof CreateCourtBlockRequestSchema>;

export const CourtBlockSchema = z.object({
  id: UuidSchema,
  courtId: UuidSchema,
  startsAt: IsoDateTimeOutSchema,
  endsAt: IsoDateTimeOutSchema,
  reason: z.string(),
});
export type CourtBlock = z.infer<typeof CourtBlockSchema>;

// ---- Social windows ----

export const SocialWindowSchema = z.object({
  id: UuidSchema,
  weekday: z.number().int().min(0).max(6),
  startsTime: TimeOfDaySchema,
  endsTime: TimeOfDaySchema,
  isActive: z.boolean(),
});
export type SocialWindow = z.infer<typeof SocialWindowSchema>;
export const SocialWindowListSchema = z.array(SocialWindowSchema);

/** PUT /social-windows/:id */
export const UpdateSocialWindowRequestSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startsTime: TimeOfDaySchema,
    endsTime: TimeOfDaySchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => !v.startsTime || !v.endsTime || v.endsTime > v.startsTime, {
    message: 'endsTime must be after startsTime',
    path: ['endsTime'],
  });
export type UpdateSocialWindowRequest = z.infer<typeof UpdateSocialWindowRequestSchema>;

// ---- Demo tool ----

/** POST /demo/booking-race (disabled in production) */
export const BookingRaceRequestSchema = z.object({
  courtId: UuidSchema,
  startsAt: IsoDateTimeSchema,
  attempts: z.number().int().min(1).max(50).default(20),
});
export type BookingRaceRequest = z.infer<typeof BookingRaceRequestSchema>;

export const BookingRaceResponseSchema = z.object({
  attempts: z.number().int(),
  confirmed: z.number().int(),
  slotTaken: z.number().int(),
  other: z.number().int(),
  durationMs: z.number(),
  bookingId: UuidSchema.nullable(),
});
export type BookingRaceResponse = z.infer<typeof BookingRaceResponseSchema>;
