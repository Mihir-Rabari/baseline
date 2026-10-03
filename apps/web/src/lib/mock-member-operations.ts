import { MemberTimelinePageSchema, type MemberTimelineItem, type CreateMemberRequest, type CreateMemberResponse, type Member, type RenewMembershipRequest } from '@packages/validation';
import { mockMemberStore } from './mock-members';
import plans from '@/mocks/plans.json';
import timeline from '@/mocks/member-timeline.json';

const timelines = new Map<string, MemberTimelineItem[]>([[mockMemberStore[0].id, MemberTimelinePageSchema.parse(timeline).data]]);
function clubDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
function plusDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function receipt(member: Member, fee: number, method: CreateMemberRequest['paymentMethod']): CreateMemberResponse {
  const today = clubDate();
  return {
    member: structuredClone(member),
    invoice: {
      id: crypto.randomUUID(), invoiceNumber: `INV-MOCK-${member.memberCode}`, status: 'PAID',
      billTo: { type: 'MEMBER', id: member.id, name: member.fullName }, issueDate: today, dueDate: today,
      lines: [{ description: `${member.membership?.plan.name} membership, 30 days`, qty: 1, unitPricePaise: fee, lineTotalPaise: fee }],
      subtotalPaise: fee, taxPaise: Math.round(fee * 18 / 118), totalPaise: fee, paidPaise: fee, balancePaise: 0, notes: null,
    },
    payment: { id: crypto.randomUUID(), amountPaise: fee, method },
  };
}
export function mockGetMember(id: string) {
  const member = mockMemberStore.find((item) => item.id === id);
  return member ? structuredClone(member) : undefined;
}
export function mockCreateMember(data: CreateMemberRequest) {
  const plan = plans.find((item) => item.id === data.planId);
  if (!plan) return undefined;
  const startsOn = data.startsOn ?? clubDate();
  const member: Member = {
    id: crypto.randomUUID(), memberCode: `CC-${String(mockMemberStore.length + 1).padStart(6, '0')}`,
    fullName: data.fullName, phone: data.phone, email: data.email ?? null, dateOfBirth: data.dateOfBirth ?? null,
    photoUrl: null, hasLogin: false, createdAt: new Date().toISOString(),
    membership: { id: crypto.randomUUID(), status: 'ACTIVE', plan: { id: plan.id, code: plan.code, name: plan.name },
      startsOn, endsOn: plusDays(startsOn, 29), daysLeft: 29, expiryState: 'OK', cancelAtPeriodEnd: false, pendingPlan: null },
    entitlements: { courtDiscountPct: plan.courtDiscountPct, shopDiscountPct: plan.shopDiscountPct,
      barDiscountPct: plan.barDiscountPct, maxBookingsPerDay: plan.maxBookingsPerDay, bookingHorizonDays: plan.bookingHorizonDays },
  };
  mockMemberStore.push(member);
  timelines.set(member.id, [{ type: 'MEMBERSHIP', at: member.createdAt, title: 'Membership started', detail: plan.name }]);
  return receipt(member, plan.monthlyFeePaise, data.paymentMethod);
}
export function mockMemberTimeline(id: string) {
  const data = structuredClone(timelines.get(id) ?? []);
  return { data, meta: { page: 1, limit: 20, totalItems: data.length, totalPages: data.length ? 1 : 0, hasNextPage: false, hasPrevPage: false } };
}
export function mockCheckinMember(id: string) {
  const member = mockGetMember(id);
  if (!member) return undefined;
  const checkedInAt = new Date().toISOString();
  timelines.set(id, [{ type: 'CHECKIN', at: checkedInAt, title: 'Checked in', detail: 'Front desk check-in' }, ...(timelines.get(id) ?? [])]);
  return { id: crypto.randomUUID(), checkedInAt, member };
}
export function mockRenewMember(id: string, data: RenewMembershipRequest) {
  const member = mockMemberStore.find((item) => item.id === id);
  const plan = plans.find((item) => item.id === member?.membership?.plan.id);
  if (!member?.membership || !plan) return undefined;
  const today = clubDate();
  const start = member.membership.endsOn >= today ? plusDays(member.membership.endsOn, 1) : today;
  member.membership = { ...member.membership, status: 'ACTIVE', startsOn: start, endsOn: plusDays(start, 29),
    daysLeft: Math.round((new Date(`${plusDays(start, 29)}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400000),
    expiryState: 'OK', cancelAtPeriodEnd: false };
  timelines.set(id, [{ type: 'MEMBERSHIP', at: new Date().toISOString(), title: 'Membership renewed', detail: plan.name }, ...(timelines.get(id) ?? [])]);
  return receipt(member, plan.monthlyFeePaise, data.paymentMethod);
}
