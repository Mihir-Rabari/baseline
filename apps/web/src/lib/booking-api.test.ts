import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema, BookingSchema, CreateTrialBookingResponseSchema, JoinSocialResponseSchema } from '@packages/validation';
import standard from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });
describe('calendar API bindings and mocks', () => {
  it('validates both availability fixtures', () => {
    expect(AvailabilitySchema.parse(standard).courts).toHaveLength(4);
    expect(AvailabilitySchema.parse(friday).courts[0].mode).toBe('SOCIAL');
  });
  it('uses authenticated endpoints, query encoding and precise booking bodies', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    const payload = { courtId: standard.courts[0].courtId, startsAt: standard.courts[0].slots[0].startsAt };
    await api.courts.availability({ date: '2026-10-09', memberId: 'b0000000-0000-4000-8000-000000000001', courtTypeId: undefined });
    await api.bookings.create(payload); await api.bookings.joinSocial(payload); await api.members.lookup('Aarav & Riya');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://club.example/api/v1/courts/availability?date=2026-10-09&memberId=b0000000-0000-4000-8000-000000000001',
      'https://club.example/api/v1/bookings', 'https://club.example/api/v1/bookings/social/join',
      'https://club.example/api/v1/members/lookup?q=Aarav+%26+Riya',
    ]);
    for (const [, options] of fetch.mock.calls) expect(options.credentials).toBe('include');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify(payload) });
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(payload) });
  });
  it('mock booking updates all overlapping cells and rejects a second booking', async () => {
    vi.setSystemTime(new Date('2031-05-13T00:00:00Z'));
    const { mockAvailability, mockCreateBooking } = await import('./mock-bookings');
    const data = mockAvailability({ date: '2031-05-14' }); const court = data.courts[0]; const slot = court.slots[0];
    const payload = { courtId: court.courtId, startsAt: slot.startsAt, guest: { name: 'Riya', phone: '9876543210' } };
    expect(BookingSchema.parse(mockCreateBooking(payload)).pricePaise).toBe(slot.pricePaise);
    const after = mockAvailability({ date: data.date });
    expect(after.courts[0].slots.slice(0, 2).map((item) => item.status)).toEqual(['BOOKED', 'BOOKED']);
    expect(() => mockCreateBooking(payload)).toThrow('no longer available');
    expect(after.courts[1].slots[0].status).toBe('FREE');
  });
  it('mock social joins decrement capacity without closing the court prematurely', async () => {
    vi.setSystemTime(new Date('2031-05-15T00:00:00Z'));
    const { mockAvailability, mockCreateBooking } = await import('./mock-bookings');
    const data = mockAvailability({ date: '2031-05-16' }); const court = data.courts[0]; const payload = { courtId: court.courtId, startsAt: court.slots[0].startsAt };
    expect(JoinSocialResponseSchema.parse(mockCreateBooking(payload, true)).socialSession.joined).toBe(6);
    expect(mockAvailability({ date: data.date }).courts[0].slots[0].spotsLeft).toBe(2);
    mockCreateBooking(payload, true); mockCreateBooking(payload, true);
    expect(mockAvailability({ date: data.date }).courts[0].slots[0].status).toBe('SOCIAL_FULL');
    expect(() => mockCreateBooking(payload, true)).toThrow('no longer available');
  });
});

describe('booking history API bindings and mocks', () => {
  it('uses the self, staff and cancel endpoints with credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    await api.bookings.mine({ scope: 'past', limit: 100 }); await api.bookings.list({ date: '2026-10-09' });
    await api.bookings.cancel('b0000000-0000-4000-8000-000000000009', { reason: 'Sick' }); await api.members.me();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://club.example/api/v1/me/bookings?scope=past&limit=100', 'https://club.example/api/v1/bookings?date=2026-10-09',
      'https://club.example/api/v1/bookings/b0000000-0000-4000-8000-000000000009/cancel', 'https://club.example/api/v1/me/member',
    ]);
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ reason: 'Sick' }) });
    for (const [, options] of fetch.mock.calls) expect(options.credentials).toBe('include');
  });
  it('mock history splits upcoming from past and cancelling moves a booking across', async () => {
    vi.setSystemTime(new Date('2031-05-13T04:00:00Z'));
    const { mockListBookings, mockCancelBooking, mockMyMember } = await import('./mock-bookings');
    const me = mockMyMember().id;
    const upcoming = mockListBookings({ scope: 'upcoming', memberId: me }).data;
    expect(upcoming).toHaveLength(3); expect(mockListBookings({ scope: 'past', memberId: me }).data).toHaveLength(3);
    const far = upcoming[1]; const result = mockCancelBooking(far.id);
    expect(result).toMatchObject({ late: false, quotaFreed: true }); expect(result.booking.status).toBe('CANCELLED');
    expect(mockListBookings({ scope: 'past', memberId: me }).data.map((item) => item.id)).toContain(far.id);
    expect(() => mockCancelBooking(far.id)).toThrow('Only confirmed');
    expect(() => mockCancelBooking('missing')).toThrow('not found');
  });
  it('mock late cancellation keeps the quota and a cancelled slot becomes free again', async () => {
    vi.setSystemTime(new Date('2031-05-13T04:00:00Z'));
    const { mockListBookings, mockCancelBooking, mockMyMember, mockAvailability, mockCreateBooking } = await import('./mock-bookings');
    const soon = mockListBookings({ scope: 'upcoming', memberId: mockMyMember().id }).data[0];
    expect(mockCancelBooking(soon.id)).toMatchObject({ late: true, quotaFreed: false });
    vi.setSystemTime(new Date('2031-05-14T00:00:00Z'));
    const data = mockAvailability({ date: '2031-05-15' }); const court = data.courts[0];
    const booking = mockCreateBooking({ courtId: court.courtId, startsAt: court.slots[0].startsAt });
    expect('member' in booking && booking.member?.id).toBe(mockMyMember().id);
    mockCancelBooking(booking.id);
    expect(mockAvailability({ date: '2031-05-15' }).courts[0].slots[0].status).toBe('FREE');
  });
});

describe('public play API bindings and mocks', () => {
  it('uses the unauthenticated public endpoints with precise bodies', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api-client');
    const trial = { courtId: standard.courts[0].courtId, startsAt: standard.courts[0].slots[0].startsAt, name: 'Riya', phone: '9876543210' };
    await api.public.availability({ date: '2026-10-09' }); await api.public.createTrialBooking(trial);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://club.example/api/v1/public/availability?date=2026-10-09', 'https://club.example/api/v1/public/trial-bookings']);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify(trial) });
  });
  it('mock trial booking is kind TRIAL, blocks the slot and refuses a second trial for the same phone', async () => {
    vi.setSystemTime(new Date('2031-05-13T00:00:00Z'));
    const { mockAvailability, mockCreateTrialBooking } = await import('./mock-bookings');
    const data = mockAvailability({ date: '2031-05-14' }); const court = data.courts[1];
    const trial = { courtId: court.courtId, startsAt: court.slots[0].startsAt, name: 'Riya', phone: '+91 98765 43210' };
    const result = mockCreateTrialBooking(trial);
    expect(CreateTrialBookingResponseSchema.parse(result).booking).toMatchObject({ kind: 'TRIAL', channel: 'WEBSITE_TRIAL', paymentStatus: expect.any(String) });
    expect(result.message).toBe('Trial booked. Pay at the club on arrival.');
    expect(mockAvailability({ date: data.date }).courts[1].slots[0].status).toBe('BOOKED');
    expect(() => mockCreateTrialBooking({ ...trial, courtId: data.courts[2].courtId, startsAt: data.courts[2].slots[0].startsAt, phone: '9876543210' })).toThrow('already used');
  });
});
