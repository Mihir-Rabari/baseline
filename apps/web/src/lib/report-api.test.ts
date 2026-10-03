import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardReportSchema, SharedDashboardReportSchema } from '@packages/validation';
import { mockDashboard } from './report-api';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); localStorage.clear(); vi.useRealTimers(); });
describe('report workflows', () => {
  it.each(['today', 'week', 'month'] as const)('produces consistent %s totals and contract-shaped trends', range => {
    const report = DashboardReportSchema.parse(mockDashboard(range));
    expect(report.trend.length).toBe(range === 'today' ? 1 : range === 'week' ? 7 : 30);
    expect(report.bySource.reduce((sum, row) => sum + row.amountPaise, 0)).toBe(report.kpis.revenuePaise);
    expect(report.byMethod.reduce((sum, row) => sum + row.amountPaise, 0)).toBe(report.kpis.revenuePaise);
  });
  it('preserves share links after reload, excludes private fields and rejects expired links', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true'); vi.useFakeTimers();
    const { reportApi } = await import('./report-api');
    const pending = reportApi.share('week'); await vi.advanceTimersByTimeAsync(300); const share = await pending;
    vi.resetModules(); const reloaded = (await import('./report-api')).reportApi;
    const result = reloaded.shared(share.token); await vi.advanceTimersByTimeAsync(300); const report = await result;
    expect(SharedDashboardReportSchema.safeParse(report).success).toBe(true);
    expect(report).not.toHaveProperty('owed'); expect(report).not.toHaveProperty('alerts');
    vi.setSystemTime(Date.parse(share.expiresAt) + 1);
    await expect(reloaded.shared(share.token)).rejects.toMatchObject({ statusCode: 404, code: 'SHARE_LINK_INVALID' });
    await expect(reloaded.shared('unknown')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('uses real range and share endpoints with credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(mockDashboard('month')), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const { reportApi } = await import('./report-api'); await reportApi.dashboard('month'); await reportApi.share('week'); await reportApi.shared('token/space');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://club.example/api/v1/reports/dashboard?range=month', 'https://club.example/api/v1/reports/shares', 'https://club.example/api/v1/public/reports/shared/token%2Fspace']);
    expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ defaultRange: 'week', expiresInDays: 7 }) });
  });
});
