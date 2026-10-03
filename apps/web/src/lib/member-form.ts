import { z } from 'zod';
import { CreateMemberRequestSchema, type Plan } from '@packages/validation';

export function clubToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function memberFormSchema(plans: Plan[], today = clubToday()) {
  return z.object({ fullName: z.string(), phone: z.string(), email: z.string().optional(), dateOfBirth: z.string().optional(), planId: z.string(), paymentMethod: z.enum(['CASH', 'CARD', 'UPI']) })
    .transform((value) => ({ ...value, email: value.email?.trim() || undefined, dateOfBirth: value.dateOfBirth || undefined }))
    .pipe(CreateMemberRequestSchema)
    .superRefine((value, context) => {
      const plan = plans.find((item) => item.id === value.planId && item.isActive);
      if (!plan) context.addIssue({ code: 'custom', path: ['planId'], message: 'Choose an available plan' });
      const dob = value.dateOfBirth;
      if (dob && dob > today) context.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Date of birth cannot be in the future' });
      if (plan?.code === 'JUNIOR') {
        if (!dob) context.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter a date of birth for Junior membership' });
        else {
          const age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4)) - (today.slice(5) < dob.slice(5) ? 1 : 0);
          if (age >= 18) context.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Junior members must be under 18' });
        }
      }
    });
}
export type MemberFormValues = z.input<ReturnType<typeof memberFormSchema>>;
