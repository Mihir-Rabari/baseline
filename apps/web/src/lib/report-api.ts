import { DashboardReportSchema, SharedDashboardReportSchema, type ReportRange, type CreateReportShareResponse } from '@packages/validation';
import { z } from 'zod';
import { API_BASE_URL, ApiError, fetchApi, mock, USE_MOCKS } from './api-client';
import { clubToday } from './member-form';

export function mockDashboard(range: ReportRange) {
  const days = range === 'today' ? 1 : range === 'week' ? 7 : 30;
  const to = clubToday();
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const trend = Array.from({ length: days }, (_, i) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + i);
    const bySource = { COURT: 42000 * (i + 1), MEMBERSHIP: 150000, SHOP: 25000, BAR: 32000, INVOICE: 18000 };
    return { bucket: date.toISOString().slice(0, 10), totalPaise: Object.values(bySource).reduce((a, b) => a + b, 0), bySource };
  });
  const revenuePaise = trend.reduce((sum, point) => sum + point.totalPaise, 0);
  return DashboardReportSchema.parse({ range, from: start.toISOString().slice(0, 10), to, generatedAt: new Date().toISOString(),
    kpis: { revenuePaise, previousRevenuePaise: Math.round(revenuePaise / 1.18), changePct: 18, bookingsCount: days * 12, utilisationPct: 68, newMembers: days * 2, shopOrdersCount: days * 8, barTabsCount: days * 6 },
    bySource: Object.keys(trend[0].bySource).map(source => ({ source, amountPaise: trend.reduce((sum, point) => sum + point.bySource[source as keyof typeof point.bySource], 0) })),
    byMethod: [{ method: 'CASH', amountPaise: Math.round(revenuePaise * .3) }, { method: 'CARD', amountPaise: Math.round(revenuePaise * .2) }, { method: 'UPI', amountPaise: revenuePaise - Math.round(revenuePaise * .3) - Math.round(revenuePaise * .2) }],
    trend, owed: { taxPayablePaise: 120000, payrollDuePaise: 5400000, unpaidInvoicesPaise: 850000, overdueInvoicesCount: 2 },
    alerts: { lowStockCount: 3, expiringMembershipsCount: 4, newLeadsCount: 6, pendingLeaveCount: 2 } });
}
const shares = new Map<string, { range: ReportRange; expiresAt: string }>();
const SharedViewSchema = SharedDashboardReportSchema.extend({ expiresAt: z.string().datetime().optional() });
export const reportApi = {
  dashboard: async (range: ReportRange) => DashboardReportSchema.parse(USE_MOCKS ? await mock(mockDashboard(range)) : await fetchApi(`/api/v1/reports/dashboard?range=${range}`)),
  exportUrl: (range: ReportRange) => `${API_BASE_URL}/api/v1/reports/export.csv?range=${range}`,
  share: async (range: ReportRange): Promise<CreateReportShareResponse> => {
    if (!USE_MOCKS) return fetchApi('/api/v1/reports/shares', { method: 'POST', body: JSON.stringify({ defaultRange: range, expiresInDays: 7 }) });
    const token = crypto.randomUUID(); const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    shares.set(token, { range, expiresAt });
    window.localStorage.setItem(`mock-report-share:${token}`, JSON.stringify({ range, expiresAt }));
    return mock({ id: crypto.randomUUID(), token, expiresAt, defaultRange: range, url: `${window.location.origin}/share/${token}` });
  },
  shared: async (token: string) => {
    if (!USE_MOCKS) return SharedViewSchema.parse(await fetchApi(`/api/v1/public/reports/shared/${encodeURIComponent(token)}`));
    const saved = typeof window === 'undefined' ? null : window.localStorage.getItem(`mock-report-share:${token}`);
    let share = shares.get(token);
    if (!share && saved) {
      try { const value: unknown = JSON.parse(saved); if (value && typeof value === 'object' && 'range' in value && ['today', 'week', 'month'].includes(String(value.range)) && 'expiresAt' in value && typeof value.expiresAt === 'string') share = { range: value.range as ReportRange, expiresAt: value.expiresAt }; } catch { /* Invalid mock storage behaves like an unavailable link. */ }
    }
    if (!share || !Number.isFinite(Date.parse(share.expiresAt)) || Date.parse(share.expiresAt) <= Date.now()) throw new ApiError('This link has expired or was revoked', 404, 'SHARE_LINK_INVALID');
    return mock(SharedViewSchema.parse({ ...mockDashboard(share.range), expiresAt: share.expiresAt }));
  },
};
