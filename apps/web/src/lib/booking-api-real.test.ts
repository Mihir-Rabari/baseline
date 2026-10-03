import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('Booking real contracts', () => {
  it('uses public/authenticated URLs and forwards server conflicts without mock fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example'); vi.resetModules();
    const api = await import('./booking-api');
    const data = api.mockAvailability({ date: '2099-01-01' }, true);
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    await api.bookingApi.availability({ date: '2099-01-01' }, true);
    expect(fetch).toHaveBeenLastCalledWith('https://club.example/api/v1/public/availability?date=2099-01-01', expect.objectContaining({ credentials: 'include' }));
    await api.bookingApi.availability({ date: '2099-01-01' }, false, true);
    expect(fetch).toHaveBeenLastCalledWith('https://club.example/api/v1/courts/availability?date=2099-01-01', expect.any(Object));
    fetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Already booked', code: 'SLOT_TAKEN' }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(api.bookingApi.create({ courtId: data.courts[0].courtId, startsAt: data.courts[0].slots[0].startsAt })).rejects.toMatchObject({ code: 'SLOT_TAKEN', statusCode: 409 });
    expect(fetch).toHaveBeenLastCalledWith('https://club.example/api/v1/bookings', expect.objectContaining({ method: 'POST' }));
  });
});
