import { describe, expect, it } from 'vitest';
import { TrialFormSchema } from './trial-form';

const form = { name: 'Riya Patel', phone: '+919811122233', email: '' };
describe('trial form validation', () => {
  it('drops a blank email and trims the phone', () => {
    expect(TrialFormSchema.parse({ ...form, phone: ' 9811122233 ' })).toEqual({ name: 'Riya Patel', phone: '9811122233', email: undefined });
  });
  it('lowercases a provided email', () => {
    expect(TrialFormSchema.parse({ ...form, email: ' RIYA@EXAMPLE.COM ' }).email).toBe('riya@example.com');
  });
  it.each([{ ...form, name: ' ' }, { ...form, phone: '12' }, { ...form, phone: '' }, { ...form, email: 'nope' }])('rejects %#', (value) => {
    expect(TrialFormSchema.safeParse(value).success).toBe(false);
  });
});
