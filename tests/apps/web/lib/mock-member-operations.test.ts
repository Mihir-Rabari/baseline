import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckinResponseSchema, CreateMemberResponseSchema, MemberTimelinePageSchema, RenewMembershipResponseSchema } from '@packages/validation';
import plans from '@/mocks/plans.json';
import { mockMemberStore, listMockMembers } from '../../../../apps/web/src/lib/mock-members';
import { mockCheckinMember, mockCreateMember, mockGetMember, mockMemberTimeline, mockRenewMember } from '../../../../apps/web/src/lib/mock-member-operations';

const original = structuredClone(mockMemberStore);
afterEach(() => {
  mockMemberStore.splice(0, mockMemberStore.length, ...structuredClone(original));
  vi.useRealTimers();
});
describe('mock member workflow', () => {
  it('registers the submitted member and exposes the same record in list and profile', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    const result = CreateMemberResponseSchema.parse(mockCreateMember({ fullName: 'Nisha Shah', phone: '9000012345', planId: plans[0].id, paymentMethod: 'UPI' }));
    expect(result.member.fullName).toBe('Nisha Shah');
    expect(result.member.membership?.plan.code).toBe('GOLD');
    expect(result.invoice.totalPaise).toBe(300000);
    expect(mockGetMember(result.member.id)).toEqual(result.member);
    expect(listMockMembers({ q: 'Nisha' }).data).toEqual([result.member]);
    expect(MemberTimelinePageSchema.parse(mockMemberTimeline(result.member.id)).data[0].title).toBe('Membership started');
  });
  it('records check-in activity and returns the contracted response', () => {
    const result = CheckinResponseSchema.parse(mockCheckinMember(original[1].id));
    expect(result.member.id).toBe(original[1].id);
    expect(MemberTimelinePageSchema.parse(mockMemberTimeline(original[1].id)).data[0].type).toBe('CHECKIN');
    expect(mockCheckinMember('missing')).toBeUndefined();
  });
  it('renews an expired membership from today and uses its plan fee', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    const member = mockMemberStore.find((item) => item.membership?.expiryState === 'EXPIRED')!;
    member.membership!.endsOn = '2026-09-30';
    const result = RenewMembershipResponseSchema.parse(mockRenewMember(member.id, { paymentMethod: 'CARD' }));
    expect(result.member.membership).toMatchObject({ startsOn: '2026-10-03', endsOn: '2026-11-01', expiryState: 'OK', daysLeft: 29 });
    expect(result.invoice.totalPaise).toBe(plans.find((plan) => plan.id === member.membership?.plan.id)?.monthlyFeePaise);
    expect(result.payment.method).toBe('CARD');
    expect(mockGetMember(member.id)?.membership?.expiryState).toBe('OK');
  });
});
