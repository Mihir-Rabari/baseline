import { AvailabilitySchema, BookingSchema, BookingPageSchema, CancelBookingResponseSchema, CreateBookingRequestSchema, JoinSocialRequestSchema, JoinSocialResponseSchema, CreateTrialBookingRequestSchema, CreateTrialBookingResponseSchema, MemberSchema, BookingRaceRequestSchema, BookingRaceResponseSchema, type AvailabilityQuery, type CreateBookingRequest, type JoinSocialRequest, type CreateTrialBookingRequest, type BookingRaceRequest } from '@packages/validation';
import { fetchApi, USE_MOCKS, mock } from './api-client';
import { mockAvailability as sharedAvailability, mockCreateBooking, mockCreateTrial, mockListBookings, mockCancelBooking, mockBookingMember, mockMyMember, resetBookingMocks, MockBookingError } from './mock-bookings';
import { calendarDate, dateAfter, slotTime } from './booking-calendar';
export { resetBookingMocks, dateAfter };
export const todayAtClub = calendarDate;
export function formatSlotTime(iso: string) { return slotTime(iso, 'Asia/Kolkata'); }
export function mockAvailability(query: AvailabilityQuery, publicView = false) {
  const data = sharedAvailability(publicView ? { date: query.date, courtTypeId: query.courtTypeId } : query);
  if (publicView) { data.priceFor = { type: 'GUEST', label: 'Walk-in' }; delete data.limits; for (const court of data.courts) for (const slot of court.slots) { delete slot.holder; delete slot.bookingId; } }
  return AvailabilitySchema.parse(data);
}
const qs = (query: object) => new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString();
const selfSubject = <T extends CreateBookingRequest | JoinSocialRequest>(input: T) => input.memberId || input.guest ? input : { ...input, memberId: mockMyMember().id };
export const bookingApi = {
  availability: async (query: AvailabilityQuery, publicView = false, self = false) => {
    const effective = publicView ? { date: query.date, courtTypeId: query.courtTypeId } : query;
    if (!USE_MOCKS) return AvailabilitySchema.parse(await fetchApi(`/api/v1/${publicView ? 'public' : 'courts'}/availability?${qs(effective)}`));
    const params = self ? { ...effective, memberId: mockMyMember().id } : effective;
    const member = mockBookingMember('memberId' in params ? params.memberId : undefined);
    const horizon = publicView ? 2 : member?.entitlements.bookingHorizonDays ?? 2;
    if (params.date > dateAfter(calendarDate(), horizon)) throw new MockBookingError('BEYOND_BOOKING_HORIZON', `Bookings open ${horizon} days ahead`, 422);
    return mock(mockAvailability(params, publicView));
  },
  create: async (input: CreateBookingRequest) => { const data = CreateBookingRequestSchema.parse(input); return USE_MOCKS ? mock(BookingSchema.parse(mockCreateBooking(selfSubject(data)))) : BookingSchema.parse(await fetchApi('/api/v1/bookings', { method: 'POST', body: JSON.stringify(data) })); },
  joinSocial: async (input: JoinSocialRequest) => { const data = JoinSocialRequestSchema.parse(input); return USE_MOCKS ? mock(JoinSocialResponseSchema.parse(mockCreateBooking(selfSubject(data), true))) : JoinSocialResponseSchema.parse(await fetchApi('/api/v1/bookings/social/join', { method: 'POST', body: JSON.stringify(data) })); },
  trial: async (input: CreateTrialBookingRequest) => { const data = CreateTrialBookingRequestSchema.parse(input); return USE_MOCKS ? mock(CreateTrialBookingResponseSchema.parse(mockCreateTrial(data))) : CreateTrialBookingResponseSchema.parse(await fetchApi('/api/v1/public/trial-bookings', { method: 'POST', body: JSON.stringify(data) })); },
  list: async (scope: 'upcoming' | 'past', staffDate?: string, page = 1) => USE_MOCKS ? mock(BookingPageSchema.parse(mockListBookings({ ...(staffDate ? { date: staffDate } : { scope, memberId: mockMyMember().id }), page, limit: 20 }))) : BookingPageSchema.parse(await fetchApi(staffDate ? `/api/v1/bookings?${qs({ date: staffDate, page, limit: 20 })}` : `/api/v1/me/bookings?${qs({ scope, page, limit: 20 })}`)),
  cancel: async (id: string, staff = false) => USE_MOCKS ? mock(mockCancelBooking(id, false, staff)) : CancelBookingResponseSchema.parse(await fetchApi(`/api/v1/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' })),
  member: async () => USE_MOCKS ? mock(MemberSchema.parse(mockMyMember())) : MemberSchema.parse(await fetchApi('/api/v1/me/member')),
  race: async (input: BookingRaceRequest) => { const data = BookingRaceRequestSchema.parse(input); return BookingRaceResponseSchema.parse(await fetchApi('/api/v1/demo/booking-race', { method: 'POST', body: JSON.stringify(data) })); },
};
