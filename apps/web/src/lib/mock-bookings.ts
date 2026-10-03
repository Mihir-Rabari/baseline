import { AvailabilitySchema, BookingSchema, type AvailabilityQuery, type Booking, type CreateBookingRequest, type JoinSocialResponse } from '@packages/validation';
import standard from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';
import { mockMemberStore } from './mock-members';

const created: Booking[] = [];
export class MockBookingError extends Error {
  constructor(public code: string, message: string, public statusCode = 409) { super(message); }
}
export function mockAvailability(query: AvailabilityQuery) {
  const fixture = new Date(`${query.date}T12:00:00Z`).getUTCDay() === 5 ? friday : standard;
  const data = AvailabilitySchema.parse(structuredClone(fixture));
  const shift = Date.parse(`${query.date}T00:00:00Z`) - Date.parse(`${data.date}T00:00:00Z`);
  data.date = query.date; data.generatedAt = new Date().toISOString();
  const member = mockMemberStore.find((item) => item.id === query.memberId);
  data.priceFor = member ? { type: 'MEMBER', label: member.fullName, memberId: member.id } : { type: 'GUEST', label: 'Walk-in' };
  if (member) data.limits = { usedToday: created.filter((item) => item.member?.id === member.id && item.bookingDate === query.date).length, maxPerDay: member.entitlements.maxBookingsPerDay };
  for (const court of data.courts) for (const slot of court.slots) {
    slot.startsAt = new Date(Date.parse(slot.startsAt) + shift).toISOString();
    slot.endsAt = new Date(Date.parse(slot.endsAt) + shift).toISOString();
    slot.pricePaise = Math.round(slot.pricePaise * (100 - (member?.entitlements.courtDiscountPct ?? 0)) / 100);
    const booked = created.filter((item) => item.court.id === court.courtId && Date.parse(item.startsAt) < Date.parse(slot.endsAt) && Date.parse(item.endsAt) > Date.parse(slot.startsAt));
    if (slot.status === 'SOCIAL_OPEN' && booked.length) {
      slot.spotsLeft = Math.max(0, (slot.spotsLeft ?? 0) - booked.length);
      if (!slot.spotsLeft) slot.status = 'SOCIAL_FULL';
    } else if (booked.length) slot.status = 'BOOKED';
    if (Date.parse(slot.startsAt) <= Date.now()) slot.status = 'PAST';
  }
  return data;
}
export function mockCreateBooking(input: CreateBookingRequest, social = false): Booking | JoinSocialResponse {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(input.startsAt));
  const data = mockAvailability({ date, memberId: input.memberId });
  const court = data.courts.find((item) => item.courtId === input.courtId);
  const slot = court?.slots.find((item) => item.startsAt === input.startsAt);
  if (!court || !slot || !['FREE', 'SOCIAL_OPEN'].includes(slot.status)) throw new MockBookingError(social ? 'SOCIAL_FULL' : 'SLOT_TAKEN', 'That session is no longer available.');
  if (social !== (slot.status === 'SOCIAL_OPEN')) throw new MockBookingError('SOCIAL_WINDOW', 'Choose the correct session type.');
  if (data.limits && data.limits.usedToday >= data.limits.maxPerDay) throw new MockBookingError('DAILY_LIMIT_REACHED', 'Daily booking limit reached.', 422);
  const member = mockMemberStore.find((item) => item.id === input.memberId);
  const booking = BookingSchema.parse({
    id: crypto.randomUUID(), court: { id: court.courtId, name: court.name, type: court.type },
    kind: social ? 'SOCIAL' : 'STANDARD', member: member ? { id: member.id, memberCode: member.memberCode, fullName: member.fullName, planCode: member.membership?.plan.code ?? null } : null,
    guest: input.guest ?? null, startsAt: slot.startsAt, endsAt: slot.endsAt, bookingDate: date,
    status: 'CONFIRMED', cancelledLate: false, channel: input.channel ?? 'DESK',
    basePricePaise: slot.pricePaise, discountPct: 0, pricePaise: slot.pricePaise,
    paymentStatus: slot.pricePaise === 0 ? 'WAIVED' : !social && input.payNow ? 'PAID' : 'UNPAID',
    socialSessionId: social ? slot.socialSessionId ?? crypto.randomUUID() : null, createdAt: new Date().toISOString(),
  });
  created.push(booking);
  return social ? { ...booking, socialSession: { capacity: slot.capacity!, joined: slot.capacity! - slot.spotsLeft! + 1 } } : booking;
}
