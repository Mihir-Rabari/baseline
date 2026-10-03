import { describe, expect, it } from 'vitest';
import { CreateMemberResponseSchema } from '@packages/validation';
import plans from '@/mocks/plans.json';
import created from '@/mocks/member-created.json';
import { memberFormSchema, clubToday } from './member-form';

const form = { fullName: 'Riya Kapoor', phone: '+919811122233', email: '', dateOfBirth: '', planId: plans[0].id, paymentMethod: 'CASH' };
const schema = memberFormSchema(plans, '2026-10-03');
describe('Member registration validation', () => {
  it('accepts optional blank fields and validates the response fixture', () => {
    expect(schema.parse(form).email).toBeUndefined();
    expect(CreateMemberResponseSchema.safeParse(created).success).toBe(true);
  });
  it.each([{ ...form, fullName: '' }, { ...form, phone: '123' }, { ...form, email: 'wrong' }, { ...form, dateOfBirth: '2027-01-01' }, { ...form, planId: '' }])('rejects invalid input %#', (value) => expect(schema.safeParse(value).success).toBe(false));
  it.each([['', false], ['2008-10-03', false], ['2008-10-04', true], ['2009-10-02', true], ['2026-10-04', false]])('validates Junior birthday %s', (dob, valid) => {
    expect(schema.safeParse({ ...form, planId: plans[2].id, dateOfBirth: dob }).success).toBe(valid);
  });
  it('uses the club date across UTC midnight boundaries', () => expect(clubToday(new Date('2026-10-02T19:00:00Z'))).toBe('2026-10-03'));
});
