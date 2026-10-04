import { DashboardReportSchema, ReportBreakdownSchema, SharedDashboardReportSchema, type ReportBreakdown, type ReportRange, type CreateReportShareResponse } from '@packages/validation';
import { z } from 'zod';
import { API_BASE_URL, ApiError, fetchApi, mock, USE_MOCKS } from './api-client';
import { clubToday } from './member-form';

/** A preset range, or an explicit club-date window. */
export type ReportPeriod = ReportRange | { from: string; to: string };
export const periodQuery = (period: ReportPeriod) => (typeof period === 'string' ? `range=${period}` : `from=${period.from}&to=${period.to}`);

export function mockBreakdown(period: ReportPeriod): ReportBreakdown {
  const days = typeof period === 'string' ? (period === 'today' ? 1 : period === 'week' ? 7 : 30) : Math.max(1, Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1);
  return ReportBreakdownSchema.parse({
    range: typeof period === 'string' ? period : 'custom', from: typeof period === 'string' ? clubToday() : period.from, to: typeof period === 'string' ? clubToday() : period.to, generatedAt: new Date().toISOString(),
    bookings: { total: days * 12, cancelled: days, bookedValuePaise: days * 12 * 80000, bySport: [{ sport: 'Padel', count: days * 7, amountPaise: days * 7 * 90000 }, { sport: 'Tennis', count: days * 5, amountPaise: days * 5 * 60000 }], byChannel: [{ channel: 'DESK', count: days * 8 }, { channel: 'ONLINE', count: days * 4 }], byCourt: [{ court: 'Padel 1', count: days * 4 }, { court: 'Tennis 1', count: days * 3 }] },
    orders: { count: days * 8, revenuePaise: days * 8 * 120000, byChannel: [{ channel: 'POS', count: days * 6, amountPaise: days * 6 * 100000 }, { channel: 'ONLINE', count: days * 2, amountPaise: days * 2 * 180000 }], topProducts: [{ name: 'Padel balls (3)', qty: days * 5, amountPaise: days * 5 * 40000 }] },
    bar: { tabsSettled: days * 6, revenuePaise: days * 6 * 90000, averageTabPaise: 90000, topItems: [{ name: 'Cold coffee', qty: days * 9, amountPaise: days * 9 * 20000 }] },
    inventory: { stockValuePaise: 18500000, unitsSold: days * 14, lowStock: [{ name: 'Grip tape', sku: 'GRP-01', stockQty: 2, reorderLevel: 5 }] },
    members: { newMembers: days * 2, activeMemberships: 120, expiringSoon: 6, byPlan: [{ plan: 'Gold', active: 40 }, { plan: 'Silver', active: 80 }] },
    payroll: { activeEmployees: 9, monthlyPayrollPaise: 5400000, pendingLeave: 2, byDepartment: [{ department: 'FRONT_DESK', employees: 4, monthlyPaise: 2000000 }, { department: 'BAR', employees: 5, monthlyPaise: 3400000 }], runs: [{ month: '2030-03', status: 'PAID', payslips: 9, netPaise: 5300000, leaveDeductionPaise: 100000, unpaidLeaveDays: 2 }], approvedLeaveDays: 5 },
  });
}

export function mockDashboard(period: ReportPeriod) {
  const range: ReportRange = typeof period === 'string' ? period : 'month';
  const days = typeof period === 'string' ? (range === 'today' ? 1 : range === 'week' ? 7 : 30) : Math.max(1, Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1);
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
  dashboard: async (period: ReportPeriod) => DashboardReportSchema.parse(USE_MOCKS ? await mock(mockDashboard(period)) : await fetchApi(`/api/v1/reports/dashboard?${periodQuery(period)}`)),
  breakdown: async (period: ReportPeriod) => ReportBreakdownSchema.parse(USE_MOCKS ? await mock(mockBreakdown(period)) : await fetchApi(`/api/v1/reports/breakdown?${periodQuery(period)}`)),
  pdfUrl: (period: ReportPeriod, type: 'summary' | 'breakdown' = 'summary') => `${API_BASE_URL}/api/v1/reports/export.pdf?${periodQuery(period)}${type === 'summary' ? '' : `&type=${type}`}`,
  exportUrl: (period: ReportPeriod, type: 'summary' | 'breakdown' | 'payments' | 'bookings' | 'orders' | 'bar' | 'inventory' | 'members' | 'payroll' = 'summary') => `${API_BASE_URL}/api/v1/reports/export.csv?${periodQuery(period)}${type === 'summary' ? '' : `&type=${type}`}`,
  share: async (period: ReportPeriod): Promise<CreateReportShareResponse> => {
    const range: ReportRange = typeof period === 'string' ? period : 'month';
    if (!USE_MOCKS) return fetchApi('/api/v1/reports/shares', { method: 'POST', body: JSON.stringify({ ...(typeof period === 'string' ? { defaultRange: period } : { from: period.from, to: period.to }), expiresInDays: 7 }) });
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
