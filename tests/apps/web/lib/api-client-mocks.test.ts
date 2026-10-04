import { afterEach, describe, expect, it, vi } from 'vitest';
import plans from '../../../../apps/web/src/mocks/plans.json';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Club API mock switch', () => {
  it('returns three contract-shaped plans after the simulated delay without fetching', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
    vi.resetModules();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { api, USE_MOCKS } = await import('../../../../apps/web/src/lib/api-client');
    vi.useFakeTimers();
    let resolved = false;
    const result = api.public.plans().then((value) => { resolved = true; return value; });

    await vi.advanceTimersByTimeAsync(299);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(plans);
    expect(USE_MOCKS).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(plans.map((plan) => plan.code)).toEqual(['GOLD', 'SILVER', 'JUNIOR']);
    expect(plans.map((plan) => plan.monthlyFeePaise)).toEqual([300000, 150000, 80000]);
    for (const plan of plans) {
      expect(Object.keys(plan).sort()).toEqual([
        'id', 'code', 'name', 'description', 'monthlyFeePaise', 'courtDiscountPct',
        'shopDiscountPct', 'barDiscountPct', 'maxBookingsPerDay', 'bookingHorizonDays',
        'minAge', 'maxAge', 'isActive',
      ].sort());
      expect(plan.isActive).toBe(true);
    }
  });

  it('keeps authenticated plans and public club available in mock mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
    vi.resetModules();
    const { api } = await import('../../../../apps/web/src/lib/api-client');
    vi.useFakeTimers();
    const plansResult = api.plans.list();
    const clubResult = api.public.club();
    await vi.advanceTimersByTimeAsync(300);
    expect(await plansResult).toEqual(plans);
    expect(await clubResult).toMatchObject({ timezone: 'Asia/Kolkata', courtTypes: expect.any(Array) });
  });

  it.each(['false', undefined])('uses real endpoints when the flag is %s', async (flag) => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', flag);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    vi.resetModules();
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(plans), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    const { api, USE_MOCKS } = await import('../../../../apps/web/src/lib/api-client');

    expect(USE_MOCKS).toBe(false);
    expect(await api.public.plans()).toEqual(plans);
    expect(await api.plans.list()).toEqual(plans);
    await api.public.club();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://club.example/api/v1/public/plans',
      'https://club.example/api/v1/plans',
      'https://club.example/api/v1/public/club',
    ]);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'include' }));
  });

  it('preserves API errors instead of falling back to mock plans', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'Plans unavailable', code: 'SERVICE_UNAVAILABLE', requestId: 'req-plans',
    }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const { api } = await import('../../../../apps/web/src/lib/api-client');
    await expect(api.public.plans()).rejects.toMatchObject({
      message: 'Plans unavailable', statusCode: 503, code: 'SERVICE_UNAVAILABLE', requestId: 'req-plans',
    });
  });
});
