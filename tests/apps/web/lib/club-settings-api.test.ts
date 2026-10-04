import { afterEach, describe, expect, it, vi } from 'vitest';
import plans from '@/mocks/plans.json';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('club settings', () => {
  it('updates a mock plan and rejects out-of-range discounts before mutation', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true'); const { clubSettingsApi } = await import('../../../../apps/web/src/lib/club-settings-api');
    const { mockMemberStore } = await import('../../../../apps/web/src/lib/mock-members');
    const plan = await clubSettingsApi.updatePlan(plans[0].id, { name: 'Gold Plus', courtDiscountPct: 80 }); expect(plan.name).toBe('Gold Plus');
    const active = mockMemberStore.find(member => member.membership?.plan.id === plans[0].id && member.membership.status === 'ACTIVE' && member.membership.expiryState !== 'EXPIRED');
    expect(active?.entitlements.courtDiscountPct).toBe(80);
    await expect(clubSettingsApi.updatePlan(plans[0].id, { courtDiscountPct: 101 })).rejects.toThrow();
    const windows = await clubSettingsApi.windows(); await expect(clubSettingsApi.updateWindow(windows[0].id, { startsTime: '22:00', endsTime: '18:00' })).rejects.toThrow();
    expect((await clubSettingsApi.windows())[0].startsTime).toBe(windows[0].startsTime);
  });
  it('uses encoded owner endpoints with exact update bodies', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example'); const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(plans[0]), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { clubSettingsApi } = await import('../../../../apps/web/src/lib/club-settings-api'); await clubSettingsApi.updatePlan('plan/a', { monthlyFeePaise: 150000 }); await clubSettingsApi.updateWindow('window/a', { isActive: false });
    expect(fetch.mock.calls[0][0]).toBe('https://club.example/api/v1/plans/plan%2Fa'); expect(fetch.mock.calls[1][0]).toBe('https://club.example/api/v1/social-windows/window%2Fa'); expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'include', body: JSON.stringify({ monthlyFeePaise: 150000 }) });
  });
});
