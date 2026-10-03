import { z } from 'zod';
import { UuidSchema } from './common.js';

/** Integer amount in paise (INR minor units). Fields ending `Paise`. */
export const PaiseSchema = z.number().int();
export const NonNegativePaiseSchema = z.number().int().min(0);
export const PositivePaiseSchema = z.number().int().positive();

/** Integer percentage 0-100. Fields ending `Pct`. */
export const PctSchema = z.number().int().min(0).max(100);

/** Business date `YYYY-MM-DD` in the club time zone. */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'Not a real calendar date');

/** Time of day `HH:MM`. */
export const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time in HH:MM format');

export const PaymentMethodSchema = z.enum(['CASH', 'CARD', 'UPI']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PlanRefSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
});
export type PlanRef = z.infer<typeof PlanRefSchema>;

export const MemberRefSchema = z.object({
  id: UuidSchema,
  memberCode: z.string(),
  fullName: z.string(),
});
export type MemberRef = z.infer<typeof MemberRefSchema>;

export const PersonRefSchema = z.object({
  id: UuidSchema,
  name: z.string(),
});
export type PersonRef = z.infer<typeof PersonRefSchema>;

/** `{ id, amountPaise, method }` returned by every operation that records a payment. */
export const PaymentReceiptSchema = z.object({
  id: UuidSchema,
  amountPaise: PaiseSchema,
  method: PaymentMethodSchema,
});
export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>;

export const RefundSchema = z.object({
  amountPaise: PaiseSchema,
  method: z.string(),
});
export type Refund = z.infer<typeof RefundSchema>;

export const SuccessMessageSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type SuccessMessage = z.infer<typeof SuccessMessageSchema>;

/** Revenue sources shared by finance and reports. */
export const RevenueSourceEnum = z.enum(['COURT', 'SHOP', 'BAR', 'MEMBERSHIP', 'INVOICE']);
export type RevenueSource = z.infer<typeof RevenueSourceEnum>;
