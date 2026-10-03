import { z } from 'zod';
import { CreateTrialBookingRequestSchema } from '@packages/validation';

const Details = CreateTrialBookingRequestSchema.pick({ name: true, phone: true, email: true });

/** Form values are strings; a blank email is dropped so the API's optional email stays absent. */
export const TrialFormSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
}).transform((value) => ({
  name: value.name,
  phone: value.phone,
  email: value.email.trim() || undefined,
})).pipe(Details);

export type TrialFormValues = z.input<typeof TrialFormSchema>;
export type TrialDetails = z.output<typeof TrialFormSchema>;
