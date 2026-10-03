import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema, BookingSchema, CancelBookingResponseSchema, JoinSocialResponseSchema, CreateTrialBookingResponseSchema } from '@packages/validation';
import fixture from '@/mocks/bookings.json';
let api: typeof import('./booking-api');
beforeEach(async () => { vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true'); vi.resetModules(); api = await import('./booking-api'); api.resetBookingMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T00:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function resolve<T>(promise: Promise<T>) { await vi.advanceTimersByTimeAsync(300); return promise; }
const memberId = 'b0000000-0000-4000-8000-000000000002';
function slot(date = '2026-10-04') { const data = api.mockAvailability({ date, memberId }); const court = data.courts[0]; return { courtId: court.courtId, startsAt: court.slots[0].startsAt, memberId }; }
describe('Booking mock flows', () => {
  it('keeps six contract-shaped seed bookings', () => { expect(fixture).toHaveLength(6); expect(BookingSchema.array().safeParse(fixture).success).toBe(true); });
  it('uses the shared availability contract and hides holders publicly', async () => {
    const data = await resolve(api.bookingApi.availability({ date: '2026-10-04' }, true));
    expect(AvailabilitySchema.safeParse(data).success).toBe(true);
    expect(data.courts).toHaveLength(4);
    expect(data.courts[0].slots).toHaveLength(12);
    expect(data.courts.flatMap((court) => court.slots).every((item) => item.holder === undefined)).toBe(true);
  });
  it('books atomically, blocks overlapping starts and cancellation restores availability', async () => {
    const request = slot();
    const booking = await resolve(api.bookingApi.create(request));
    expect(BookingSchema.safeParse(booking).success).toBe(true);
    await expect(api.bookingApi.create(request)).rejects.toMatchObject({ code: 'SLOT_TAKEN' });
    const adjacent = { ...request, startsAt: new Date(Date.parse(request.startsAt) + 1800000).toISOString() };
    await expect(api.bookingApi.create(adjacent)).rejects.toMatchObject({ code: 'SLOT_TAKEN' });
    expect(api.mockAvailability({ date: '2026-10-04' }).courts[0].slots[0].status).toBe('BOOKED');
    const cancelled = await resolve(api.bookingApi.cancel(booking.id, true));
    expect(CancelBookingResponseSchema.safeParse(cancelled).success).toBe(true);
    expect(cancelled.booking.status).toBe('CANCELLED');
    expect(api.mockAvailability({ date: '2026-10-04' }).courts[0].slots[0].status).toBe('FREE');
    await expect(api.bookingApi.cancel(booking.id, true)).rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
  });
  it('enforces daily limits and cross-court double booking', async () => {
    const request = slot(); await resolve(api.bookingApi.create(request));
    const courtId = api.mockAvailability({ date: '2026-10-04' }).courts[1].courtId;
    await expect(api.bookingApi.create({ ...request, courtId })).rejects.toMatchObject({ code: 'MEMBER_DOUBLE_BOOKED' });
    const next = api.mockAvailability({ date: '2026-10-04', memberId }).courts[0].slots.find((item) => item.status === 'FREE')!;
    await resolve(api.bookingApi.create({ ...request, startsAt: next.startsAt }));
    const third = api.mockAvailability({ date: '2026-10-04', memberId }).courts[0].slots.find((item) => item.status === 'FREE')!;
    await expect(api.bookingApi.create({ ...request, startsAt: third.startsAt })).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' });
  });
  it('updates social spaces and refuses a full session', async () => {
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    const request = slot('2026-10-09');
    let sessionId: string | null = null;
    const initialSlot = api.mockAvailability({ date: '2026-10-09' }).courts[0].slots[0];
    for (let i = 0; i < initialSlot.spotsLeft!; i++) {
      const result = await resolve(api.bookingApi.joinSocial({ ...request, memberId: undefined, guest: { name: `Guest ${i}`, phone: '9876543210' } }));
      expect(JoinSocialResponseSchema.safeParse(result).success).toBe(true);
      expect(result.socialSession.joined).toBe(initialSlot.capacity! - initialSlot.spotsLeft! + i + 1);
      if (i === 0) sessionId = result.socialSessionId;
      expect(result.socialSessionId).toBe(sessionId);
    }
    await expect(api.bookingApi.joinSocial({ ...request, memberId: undefined, guest: { name: 'Extra', phone: '9876543210' } })).rejects.toMatchObject({ code: 'SOCIAL_FULL' });
  });
  it('prices Gold, Silver, Junior and expired members from the shared store', async () => {
    const { mockMemberStore } = await import('./mock-members');
    const [gold, silver, junior] = mockMemberStore;
    junior.membership!.status = 'ACTIVE'; junior.membership!.expiryState = 'OK'; junior.membership!.endsOn = '2026-10-28';
    junior.entitlements = { ...junior.entitlements, courtDiscountPct: 50, maxBookingsPerDay: 2, bookingHorizonDays: 7 };
    expect(api.mockAvailability({ date: '2026-10-04', memberId: gold.id }).courts[0].slots[0].pricePaise).toBe(0);
    expect(api.mockAvailability({ date: '2026-10-04', memberId: silver.id }).courts[0].slots[0].pricePaise).toBe(42000);
    expect(api.mockAvailability({ date: '2026-10-04', memberId: junior.id }).courts[0].slots[0].pricePaise).toBe(30000);
    junior.membership!.expiryState = 'EXPIRED';
    expect(api.mockAvailability({ date: '2026-10-04', memberId: junior.id }).courts[0].slots[0].pricePaise).toBe(60000);
    await expect(api.bookingApi.create({ ...slot(), memberId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('uses plan-specific quotas and horizons and preserves late cancellation quota', async () => {
    const { mockMemberStore } = await import('./mock-members'); const member = mockMemberStore[1];
    member.entitlements.maxBookingsPerDay = 1;
    await expect(api.bookingApi.availability({ date: '2026-10-11', memberId: member.id })).rejects.toMatchObject({ code: 'BEYOND_BOOKING_HORIZON' });
    vi.setSystemTime(new Date('2026-10-03T02:00:00Z'));
    const request = slot('2026-10-03'); const result = await resolve(api.bookingApi.create(request));
    const cancelled = await resolve(api.bookingApi.cancel(result.id, true)); expect(cancelled.late).toBe(true);
    expect(api.mockAvailability({ date: '2026-10-03', memberId: member.id }).limits?.usedToday).toBe(1);
    await expect(api.bookingApi.create({ ...request, startsAt: request.startsAt.replace('.000Z', 'Z') })).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' });
  });
  it('trial uses the trial fee and prevents reuse by phone', async () => {
    const request = { ...slot(), name: 'Riya', phone: '9876543210' };
    const result = await resolve(api.bookingApi.trial(request));
    expect(CreateTrialBookingResponseSchema.safeParse(result).success).toBe(true);
    expect(result.booking.kind).toBe('TRIAL');
    expect(result.booking.pricePaise).toBe(19900);
    await expect(api.bookingApi.trial({ ...request, startsAt: '2026-10-04T13:00:00.000Z' })).rejects.toMatchObject({ code: 'TRIAL_ALREADY_USED' });
  });
  it('keeps member lists private and denies cancellation of another member’s booking', async () => {
    const { mockMemberStore } = await import('./mock-members');
    const result = await resolve(api.bookingApi.create({ ...slot(), memberId: mockMemberStore[1].id }));
    expect((await resolve(api.bookingApi.list('upcoming'))).data).toHaveLength(0);
    await expect(api.bookingApi.cancel(result.id)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect((await resolve(api.bookingApi.list('upcoming', '2026-10-04'))).data).toHaveLength(1);
    expect((await resolve(api.bookingApi.cancel(result.id, true))).booking.status).toBe('CANCELLED');
  });
  it('shares main-calendar state with public availability and cancellation', async () => {
    const { api: mainApi } = await import('./api-client');
    const request = { ...slot(), guest: { name: 'Riya', phone: '9876543210' }, memberId: undefined };
    const pending = mainApi.bookings.create(request); await vi.advanceTimersByTimeAsync(400); const booking = await pending;
    expect(api.mockAvailability({ date: '2026-10-04' }, true).courts[0].slots[0].status).toBe('BOOKED');
    expect((await resolve(api.bookingApi.list('upcoming', '2026-10-04'))).data.some((item) => item.id === booking.id)).toBe(true);
    await resolve(api.bookingApi.cancel(booking.id, true));
    const refreshed = mainApi.courts.availability({ date: '2026-10-04' }); await vi.advanceTimersByTimeAsync(300);
    expect((await refreshed).courts[0].slots[0].status).toBe('FREE');
  });
  it('allows cancellation at the exact two-hour cutoff', async () => {
    vi.setSystemTime(new Date('2026-10-03T01:00:00Z'));
    const result = await resolve(api.bookingApi.create(slot('2026-10-03')));
    vi.setSystemTime(new Date('2026-10-03T01:00:00Z'));
    expect(await resolve(api.bookingApi.cancel(result.id, true))).toMatchObject({ late: false, quotaFreed: true });
  });
});
