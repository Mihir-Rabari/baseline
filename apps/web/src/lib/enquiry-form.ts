import { z } from 'zod';
import { CreateEnquiryRequestSchema } from '@packages/validation';

export const EnquiryFormSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  message: z.string().trim().min(5, 'Tell us a little more'),
  interestedPlanId: z.string(),
}).transform((value) => ({
  ...value,
  phone: value.phone.trim() || undefined,
  email: value.email.trim() || undefined,
  interestedPlanId: value.interestedPlanId || undefined,
})).pipe(CreateEnquiryRequestSchema);

export type EnquiryFormValues = z.input<typeof EnquiryFormSchema>;
