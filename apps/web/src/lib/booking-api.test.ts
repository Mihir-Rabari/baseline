import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema, BookingSchema, JoinSocialResponseSchema } from '@packages/validation';
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
