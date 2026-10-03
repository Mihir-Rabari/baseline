import { AvailabilitySchema, BookingSchema, type AvailabilityQuery, type Booking, type BookingPage, type CancelBookingResponse, type CreateBookingRequest, type CreateTrialBookingRequest, type CreateTrialBookingResponse, type JoinSocialResponse } from '@packages/validation';
import standard from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';
import { mockMemberStore } from './mock-members';

const created: Booking[] = [];
const CANCEL_CUTOFF_MS = 2 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
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
  if (member) data.limits = { usedToday: created.filter((item) => item.status === 'CONFIRMED' && item.member?.id === member.id && item.bookingDate === query.date).length, maxPerDay: member.entitlements.maxBookingsPerDay };
  for (const court of data.courts) for (const slot of court.slots) {
    slot.startsAt = new Date(Date.parse(slot.startsAt) + shift).toISOString();
    slot.endsAt = new Date(Date.parse(slot.endsAt) + shift).toISOString();
    slot.pricePaise = Math.round(slot.pricePaise * (100 - (member?.entitlements.courtDiscountPct ?? 0)) / 100);
    const booked = created.filter((item) => item.status === 'CONFIRMED' && item.court.id === court.courtId && Date.parse(item.startsAt) < Date.parse(slot.endsAt) && Date.parse(item.endsAt) > Date.parse(slot.startsAt));
    if (slot.status === 'SOCIAL_OPEN' && booked.length) {
      slot.spotsLeft = Math.max(0, (slot.spotsLeft ?? 0) - booked.length);
      if (!slot.spotsLeft) slot.status = 'SOCIAL_FULL';
    } else if (booked.length) slot.status = 'BOOKED';
    if (Date.parse(slot.startsAt) <= Date.now()) slot.status = 'PAST';
  }
  return data;
}
const trialPhones = new Set<string>();
export function mockCreateTrialBooking(input: CreateTrialBookingRequest): CreateTrialBookingResponse {
  const phone = input.phone.replace(/\D/g, '').slice(-10);
  if (trialPhones.has(phone)) throw new MockBookingError('TRIAL_ALREADY_USED', 'This phone number has already used a free trial.');
  const booking = mockCreateBooking({ courtId: input.courtId, startsAt: input.startsAt, guest: { name: input.name, phone: input.phone, email: input.email }, channel: 'ONLINE' });
  trialPhones.add(phone);
  const stored = created.find((item) => item.id === booking.id)!;
  stored.kind = 'TRIAL'; stored.channel = 'WEBSITE_TRIAL';
  return { booking: { ...stored }, leadId: crypto.randomUUID(), message: 'Trial booked. Pay at the club on arrival.' };
}
export function mockCreateBooking(input: CreateBookingRequest, social = false): Booking | JoinSocialResponse {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(input.startsAt));
  const data = mockAvailability({ date, memberId: input.memberId });
  const court = data.courts.find((item) => item.courtId === input.courtId);
  const slot = court?.slots.find((item) => item.startsAt === input.startsAt);
  if (!court || !slot || !['FREE', 'SOCIAL_OPEN'].includes(slot.status)) throw new MockBookingError(social ? 'SOCIAL_FULL' : 'SLOT_TAKEN', 'That session is no longer available.');
  if (social !== (slot.status === 'SOCIAL_OPEN')) throw new MockBookingError('SOCIAL_WINDOW', 'Choose the correct session type.');
  if (data.limits && data.limits.usedToday >= data.limits.maxPerDay) throw new MockBookingError('DAILY_LIMIT_REACHED', 'Daily booking limit reached.', 422);
  const member = mockMemberStore.find((item) => item.id === (input.memberId ?? (input.guest ? undefined : mockMyMember().id)));
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

/** The signed-in member in mock mode: the first fixture member. */
export const mockMyMember = () => mockMemberStore[0];

function seedHistory() {
  const court = standard.courts[0];
  const me = mockMyMember();
  const make = (hoursFromNow: number, status: Booking['status'], paid: Booking['paymentStatus']): Booking => {
    const start = new Date(Math.ceil((Date.now() + hoursFromNow * HOUR) / HOUR) * HOUR);
    return BookingSchema.parse({
      id: crypto.randomUUID(), court: { id: court.courtId, name: court.name, type: court.type }, kind: 'STANDARD',
      member: { id: me.id, memberCode: me.memberCode, fullName: me.fullName, planCode: me.membership?.plan.code ?? null }, guest: null,
      startsAt: start.toISOString(), endsAt: new Date(start.getTime() + HOUR).toISOString(),
      bookingDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(start),
      status, cancelledLate: false, channel: 'ONLINE', basePricePaise: 60000, discountPct: 0, pricePaise: 60000,
      paymentStatus: paid, socialSessionId: null, createdAt: new Date(Date.now() - 48 * HOUR).toISOString(),
    });
  };
  return [make(1.2, 'CONFIRMED', 'UNPAID'), make(28, 'CONFIRMED', 'PAID'), make(75, 'CONFIRMED', 'UNPAID'),
    make(-30, 'COMPLETED', 'PAID'), make(-54, 'CANCELLED', 'REFUNDED'), make(-100, 'NO_SHOW', 'UNPAID')];
}
let seeded = false;
function allBookings() {
  if (!seeded) { seeded = true; created.push(...seedHistory()); }
  return created;
}

export function mockListBookings(query: { scope?: 'upcoming' | 'past'; date?: string; memberId?: string }): BookingPage {
  const now = Date.now();
  const rows = allBookings().filter((item) => (!query.memberId || item.member?.id === query.memberId) && (!query.date || item.bookingDate === query.date)
    && (!query.scope || ((item.status === 'CONFIRMED' && Date.parse(item.endsAt) > now) === (query.scope === 'upcoming'))));
  rows.sort((a, b) => query.scope === 'past' ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { data: rows.map((item) => ({ ...item })), meta: { page: 1, limit: 100, totalItems: rows.length, totalPages: rows.length ? 1 : 0, hasNextPage: false, hasPrevPage: false } };
}

export function mockCancelBooking(id: string, override = false): CancelBookingResponse {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking) throw new MockBookingError('NOT_FOUND', 'Booking not found.', 404);
  if (booking.status !== 'CONFIRMED') throw new MockBookingError('NOT_CANCELLABLE', 'Only confirmed bookings can be cancelled.');
  const late = !override && Date.parse(booking.startsAt) - Date.now() < CANCEL_CUTOFF_MS;
  booking.status = 'CANCELLED'; booking.cancelledLate = late;
  if (!late && booking.paymentStatus === 'PAID') booking.paymentStatus = 'REFUNDED';
  return { booking: { ...booking }, refund: null, quotaFreed: !late, late };
}
