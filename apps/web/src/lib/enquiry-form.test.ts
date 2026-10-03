import { describe, expect, it } from 'vitest';
import { EnquiryFormSchema } from './enquiry-form';

const form = { name: 'Riya Kapoor', phone: '', email: '', message: 'Tell me about membership', interestedPlanId: '' };
describe('Enquiry form validation', () => {
  it('accepts phone only and removes blank optional fields', () => {
    expect(EnquiryFormSchema.parse({ ...form, phone: '+919811122233' })).toEqual({ name: form.name, phone: '+919811122233', message: form.message, email: undefined, interestedPlanId: undefined });
  });
  it('accepts email only and normalizes whitespace and case', () => {
    expect(EnquiryFormSchema.parse({ ...form, email: ' RIYA@EXAMPLE.COM ', phone: ' ' }).email).toBe('riya@example.com');
  });
  it.each([
    form,
    { ...form, email: 'invalid' },
    { ...form, phone: '123' },
    { ...form, email: 'riya@example.com', name: ' ' },
    { ...form, email: 'riya@example.com', message: 'Hey' },
    { ...form, email: 'riya@example.com', interestedPlanId: 'GOLD' },
  ])('rejects invalid enquiries %#', (value) => {
    expect(EnquiryFormSchema.safeParse(value).success).toBe(false);
  });
});
