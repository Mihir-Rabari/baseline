import { AvailabilitySchema, BookingSchema, CreateBookingRequestSchema, JoinSocialRequestSchema, CreateTrialBookingRequestSchema, CreatePublicBookingRequestSchema, CreatePublicBookingResponseSchema, promiseFeePaise, type CreatePublicBookingRequest, type CreatePublicBookingResponse, type AvailabilityQuery, type Booking, type CreateBookingRequest, type JoinSocialResponse, type CreateTrialBookingRequest, type CancelBookingResponse } from '@packages/validation';
import standard from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';
import club from '@/mocks/club.json';
import { mockMemberStore } from './mock-members';
import { calendarDate, dateAfter } from './booking-calendar';

export const mockBookingStore: Booking[] = [];
let seeded = false;
const trialPhones = new Set<string>();
export function resetBookingMocks() { mockBookingStore.splice(0); trialPhones.clear(); seeded = true; }
export class MockBookingError extends Error {
  constructor(public code: string, message: string, public statusCode = 409) { super(message); }
}
function fail(code: string, message: string, status = 409): never { throw new MockBookingError(code, message, status); }
export function mockBookingMember(id?: string) {
  if (!id) return undefined;
  const member = mockMemberStore.find((item) => item.id === id);
  if (!member) fail('NOT_FOUND', 'Member not found', 404);
  return member;
}
function active(member: ReturnType<typeof mockBookingMember>) {
  return Boolean(member?.membership?.status === 'ACTIVE' && !['EXPIRED', 'NONE'].includes(member.membership.expiryState));
}
export function mockAvailability(query: AvailabilityQuery) {
  const fixture = new Date(`${query.date}T12:00:00Z`).getUTCDay() === 5 ? friday : standard;
  const data = AvailabilitySchema.parse(structuredClone(fixture));
  const shift = Date.parse(`${query.date}T00:00:00Z`) - Date.parse(`${data.date}T00:00:00Z`);
  data.date = query.date; data.generatedAt = new Date().toISOString();
  const member = mockBookingMember(query.memberId);
  data.priceFor = member ? { type: 'MEMBER', label: member.fullName, memberId: member.id } : { type: 'GUEST', label: 'Walk-in' };
  if (member) data.limits = { usedToday: mockBookingStore.filter((item) => item.member?.id === member.id && item.bookingDate === query.date && (item.status !== 'CANCELLED' || item.cancelledLate)).length, maxPerDay: member.entitlements.maxBookingsPerDay };
  if (query.courtTypeId) data.courts = data.courts.filter((court) => club.courtTypes.find((type) => type.id === query.courtTypeId)?.code === court.type);
  for (const court of data.courts) for (const slot of court.slots) {
    slot.startsAt = new Date(Date.parse(slot.startsAt) + shift).toISOString();
    slot.endsAt = new Date(Date.parse(slot.endsAt) + shift).toISOString();
    slot.pricePaise = Math.round(slot.pricePaise * (100 - (active(member) ? member!.entitlements.courtDiscountPct : 0)) / 100);
    const booked = mockBookingStore.filter((item) => item.status === 'CONFIRMED' && item.court.id === court.courtId && Date.parse(item.startsAt) < Date.parse(slot.endsAt) && Date.parse(item.endsAt) > Date.parse(slot.startsAt));
    if (slot.status === 'SOCIAL_OPEN' && booked.length) {
      slot.spotsLeft = Math.max(0, (slot.spotsLeft ?? 0) - booked.filter((item) => item.kind === 'SOCIAL').length);
      slot.socialSessionId = booked.find((item) => item.kind === 'SOCIAL')?.socialSessionId ?? slot.socialSessionId;
      if (booked.some((item) => item.kind !== 'SOCIAL')) slot.status = 'BOOKED';
      else if (!slot.spotsLeft) slot.status = 'SOCIAL_FULL';
    } else if (booked.length) slot.status = 'BOOKED';
    if (slot.status === 'BOOKED' && booked.length) { slot.bookingId = booked[0].id; slot.holder = booked[0].member?.fullName ?? booked[0].guest?.name; }
    if (Date.parse(slot.startsAt) <= Date.now()) slot.status = 'PAST';
  }
  return data;
}
function create(input: CreateBookingRequest, kind: 'STANDARD' | 'SOCIAL' | 'TRIAL'): Booking | JoinSocialResponse {
  input = { ...input, startsAt: new Date(input.startsAt).toISOString() };
  const date = calendarDate(new Date(input.startsAt));
  const member = mockBookingMember(input.memberId);
  const horizon = kind === 'TRIAL' ? 7 : member?.entitlements.bookingHorizonDays ?? 2;
  if (date > dateAfter(calendarDate(), horizon)) fail('BEYOND_BOOKING_HORIZON', `Bookings open ${horizon} days ahead`, 422);
  if (active(member) && member!.membership!.endsOn < date) fail('MEMBERSHIP_EXPIRES_BEFORE_SLOT', 'Membership expires before this slot', 422);
  const data = mockAvailability({ date, memberId: input.memberId });
  const court = data.courts.find((item) => item.courtId === input.courtId);
  const slot = court?.slots.find((item) => item.startsAt === input.startsAt);
  if (!court || !slot || !['FREE', 'SOCIAL_OPEN'].includes(slot.status)) fail(kind === 'SOCIAL' ? 'SOCIAL_FULL' : 'SLOT_TAKEN', 'That session is no longer available.');
  if ((kind === 'SOCIAL') !== (slot.status === 'SOCIAL_OPEN')) fail('SOCIAL_WINDOW', 'Choose the correct session type.');
  if (member && data.limits && data.limits.usedToday >= data.limits.maxPerDay) fail('DAILY_LIMIT_REACHED', 'Daily booking limit reached.', 422);
  if (member && mockBookingStore.some((item) => item.member?.id === member.id && item.status === 'CONFIRMED' && Date.parse(item.startsAt) < Date.parse(slot.endsAt) && Date.parse(item.endsAt) > Date.parse(slot.startsAt))) fail('MEMBER_DOUBLE_BOOKED', 'Member already has an overlapping booking');
  const discount = active(member) ? member!.entitlements.courtDiscountPct : 0;
  const baseRate = kind === 'SOCIAL' ? friday.courts.find((item) => item.courtId === input.courtId)?.slots.find((item) => item.startsAt.slice(11) === input.startsAt.slice(11))?.pricePaise ?? slot.pricePaise : club.courtTypes.find((type) => type.code === court.type)?.baseRatePaise ?? slot.pricePaise;
  const price = kind === 'TRIAL' ? club.courtTypes.find((type) => type.code === court.type)?.trialFeePaise ?? 19900 : slot.pricePaise;
  const subject = member ?? (input.guest ? undefined : mockMyMember());
  const booking = BookingSchema.parse({
    id: crypto.randomUUID(), court: { id: court.courtId, name: court.name, type: court.type }, kind,
    member: subject ? { id: subject.id, memberCode: subject.memberCode, fullName: subject.fullName } : null,
    guest: input.guest ?? null, startsAt: slot.startsAt, endsAt: slot.endsAt, bookingDate: date,
    status: 'CONFIRMED', cancelledLate: false, channel: kind === 'TRIAL' ? 'WEBSITE_TRIAL' : input.channel ?? 'DESK',
    basePricePaise: baseRate, discountPct: discount, pricePaise: price,
    paymentStatus: price === 0 ? 'WAIVED' : kind !== 'SOCIAL' && input.payNow ? (input.payNow.method === 'CASH' ? 'PARTIAL' : 'PAID') : 'UNPAID',
    socialSessionId: kind === 'SOCIAL' ? slot.socialSessionId ?? crypto.randomUUID() : null, createdAt: new Date().toISOString(),
  });
  mockBookingStore.push(booking);
  return kind === 'SOCIAL' ? { ...structuredClone(booking), socialSession: { capacity: slot.capacity!, joined: slot.capacity! - slot.spotsLeft! + 1 } } : structuredClone(booking);
}
export function mockCreateBooking(input: CreateBookingRequest, social = false) {
  return create(social ? JoinSocialRequestSchema.parse(input) : CreateBookingRequestSchema.parse(input), social ? 'SOCIAL' : 'STANDARD');
}
export function mockCreateTrial(input: CreateTrialBookingRequest) {
  const data = CreateTrialBookingRequestSchema.parse(input);
  if (trialPhones.has(data.phone)) fail('TRIAL_ALREADY_USED', 'This phone has already used a trial');
  const booking = create({ courtId: data.courtId, startsAt: data.startsAt, guest: { name: data.name, phone: data.phone, email: data.email } }, 'TRIAL');
  trialPhones.add(data.phone);
  return { booking, leadId: crypto.randomUUID(), message: 'Trial booked. Pay at the club on arrival.' };
}
export function mockGuestBook(input: CreatePublicBookingRequest): CreatePublicBookingResponse {
  const data = CreatePublicBookingRequestSchema.parse(input);
  const booking = create({ courtId: data.courtId, startsAt: data.startsAt, guest: { name: data.name, phone: data.phone, email: data.email }, channel: 'ONLINE', payNow: { method: data.method } }, 'STANDARD');
  const paidPaise = data.method === 'CASH' ? promiseFeePaise(booking.pricePaise) : booking.pricePaise;
  const result = { ...booking, paymentStatus: paidPaise < booking.pricePaise ? ('PARTIAL' as const) : booking.paymentStatus };
  return CreatePublicBookingResponseSchema.parse({ booking: result, paidPaise, duePaise: booking.pricePaise - paidPaise, message: paidPaise < booking.pricePaise ? 'Booked. Pay the rest at the club.' : 'Booked and paid. See you on court.' });
}
export const mockMyMember = () => mockMemberStore[0];
function allBookings() {
  if (!seeded) {
    seeded = true;
    const me = mockMyMember(); const court = standard.courts[0]; const hour = 3600000;
    const make = (hours: number, status: Booking['status'], paymentStatus: Booking['paymentStatus']) => {
      const start = new Date(Math.ceil((Date.now() + hours * hour) / hour) * hour);
      return BookingSchema.parse({ id: crypto.randomUUID(), court: { id: court.courtId, name: court.name, type: court.type }, kind: 'STANDARD', member: { id: me.id, memberCode: me.memberCode, fullName: me.fullName }, guest: null, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + hour).toISOString(), bookingDate: calendarDate(start), status, cancelledLate: false, channel: 'ONLINE', basePricePaise: 60000, discountPct: 0, pricePaise: 60000, paymentStatus, socialSessionId: null, createdAt: new Date(Date.now() - 48 * hour).toISOString() });
    };
    mockBookingStore.push(make(0.2, 'CONFIRMED', 'UNPAID'), make(28, 'CONFIRMED', 'PAID'), make(75, 'CONFIRMED', 'UNPAID'), make(-30, 'COMPLETED', 'PAID'), make(-54, 'CANCELLED', 'REFUNDED'), make(-100, 'NO_SHOW', 'UNPAID'));
  }
  return mockBookingStore;
}
export function mockListBookings(query: { scope?: 'upcoming' | 'past'; date?: string; memberId?: string; page?: number; limit?: number }) {
  const page = query.page ?? 1; const limit = query.limit ?? 100;
  const filtered = allBookings().filter((item) => (!query.memberId || item.member?.id === query.memberId) && (!query.date || item.bookingDate === query.date) && (!query.scope || (item.status === 'CONFIRMED' && Date.parse(item.endsAt) > Date.now()) === (query.scope === 'upcoming')));
  filtered.sort((a, b) => query.scope === 'past' ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const totalPages = Math.ceil(filtered.length / limit);
  return { data: structuredClone(filtered.slice((page - 1) * limit, page * limit)), meta: { page, limit, totalItems: filtered.length, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 } };
}
export function mockCancelBooking(id: string, override = false, staff = true): CancelBookingResponse {
  const booking = allBookings().find((item) => item.id === id);
  if (!booking) fail('NOT_FOUND', 'Booking not found', 404);
  if (!staff && booking.member?.id !== mockMyMember().id) fail('FORBIDDEN', 'This is another member’s booking', 403);
  if (booking.status !== 'CONFIRMED') fail('CANCEL_NOT_ALLOWED', 'Only confirmed bookings can be cancelled.');
  if (Date.parse(booking.startsAt) <= Date.now()) fail('CANCEL_NOT_ALLOWED', 'This booking cannot be cancelled');
  const late = !override && Date.parse(booking.startsAt) - Date.now() < 7200000;
  booking.status = 'CANCELLED'; booking.cancelledLate = late;
  if (!late && booking.paymentStatus === 'PAID') booking.paymentStatus = 'REFUNDED';
  return { booking: structuredClone(booking), late, quotaFreed: !late, refund: null };
}
