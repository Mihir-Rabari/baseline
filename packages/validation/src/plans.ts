import { z } from 'zod';
import { UuidSchema } from './common.js';
import { NonNegativePaiseSchema, PctSchema } from './domain-common.js';

export const PlanSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  monthlyFeePaise: NonNegativePaiseSchema,
  courtDiscountPct: PctSchema,
  shopDiscountPct: PctSchema,
  barDiscountPct: PctSchema,
  maxBookingsPerDay: z.number().int().min(0),
  bookingHorizonDays: z.number().int().min(0),
  minAge: z.number().int().min(0).nullable(),
  maxAge: z.number().int().min(0).nullable(),
  isActive: z.boolean(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanListSchema = z.array(PlanSchema);
export type PlanList = z.infer<typeof PlanListSchema>;

/** PUT /plans/:id */
export const UpdatePlanRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    monthlyFeePaise: NonNegativePaiseSchema,
    courtDiscountPct: PctSchema,
    shopDiscountPct: PctSchema,
    barDiscountPct: PctSchema,
    maxBookingsPerDay: z.number().int().min(1).max(50),
    bookingHorizonDays: z.number().int().min(1).max(365),
    isActive: z.boolean(),
  })
  .partial();
export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequestSchema>;
