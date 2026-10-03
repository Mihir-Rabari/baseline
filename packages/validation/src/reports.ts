import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { DateOnlySchema, PaiseSchema, PaymentMethodSchema, PctSchema, RevenueSourceEnum } from './domain-common.js';

export const ReportRangeEnum = z.enum(['today', 'week', 'month']);
export type ReportRange = z.infer<typeof ReportRangeEnum>;

/** GET /reports/dashboard and /reports/export.csv: `range`, or `from` and `to` together. */
export const ReportRangeQuerySchema = z
  .object({
    range: ReportRangeEnum.optional(),
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
  })
  .refine((v) => Boolean(v.from) === Boolean(v.to), {
    message: 'from and to must be provided together',
    path: ['to'],
  })
  .refine((v) => !v.range || !v.from, {
    message: 'Use either range or from+to, not both',
    path: ['range'],
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });
export type ReportRangeQuery = z.infer<typeof ReportRangeQuerySchema>;

export const DashboardKpisSchema = z.object({
  revenuePaise: PaiseSchema,
  previousRevenuePaise: PaiseSchema,
  changePct: z.number(),
  bookingsCount: z.number().int().min(0),
  utilisationPct: PctSchema,
  newMembers: z.number().int().min(0),
  shopOrdersCount: z.number().int().min(0),
  barTabsCount: z.number().int().min(0),
});
export type DashboardKpis = z.infer<typeof DashboardKpisSchema>;

export const DashboardTrendPointSchema = z.object({
  bucket: z.string(),
  totalPaise: PaiseSchema,
  bySource: z.record(RevenueSourceEnum, PaiseSchema),
});
export type DashboardTrendPoint = z.infer<typeof DashboardTrendPointSchema>;

export const DashboardReportSchema = z.object({
  range: z.string(),
  from: DateOnlySchema,
  to: DateOnlySchema,
  generatedAt: IsoDateTimeOutSchema,
  kpis: DashboardKpisSchema,
  bySource: z.array(z.object({ source: RevenueSourceEnum, amountPaise: PaiseSchema })),
  byMethod: z.array(z.object({ method: PaymentMethodSchema, amountPaise: PaiseSchema })),
  trend: z.array(DashboardTrendPointSchema),
  owed: z.object({
    taxPayablePaise: PaiseSchema,
    payrollDuePaise: PaiseSchema,
    unpaidInvoicesPaise: PaiseSchema,
    overdueInvoicesCount: z.number().int().min(0),
  }),
  alerts: z.object({
    lowStockCount: z.number().int().min(0),
    expiringMembershipsCount: z.number().int().min(0),
    newLeadsCount: z.number().int().min(0),
    pendingLeaveCount: z.number().int().min(0),
  }),
});
export type DashboardReport = z.infer<typeof DashboardReportSchema>;

/** Public shared view: summary only (kpis, bySource, byMethod, trend), no owed/alerts. */
export const SharedDashboardReportSchema = DashboardReportSchema.omit({ owed: true, alerts: true });
export type SharedDashboardReport = z.infer<typeof SharedDashboardReportSchema>;

/** GET /public/reports/shared/:token: the summary plus when the link stops working. */
export const SharedReportResponseSchema = SharedDashboardReportSchema.extend({ expiresAt: IsoDateTimeOutSchema });
export type SharedReportResponse = z.infer<typeof SharedReportResponseSchema>;

/** GET /reports/export.csv */
export const ReportExportQuerySchema = z
  .object({
    range: ReportRangeEnum.optional(),
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
    type: z.enum(['summary', 'payments', 'breakdown', 'bookings', 'orders', 'bar', 'inventory', 'members', 'payroll']).default('summary'),
  })
  .refine((v) => Boolean(v.from) === Boolean(v.to), {
    message: 'from and to must be provided together',
    path: ['to'],
  })
  .refine((v) => !v.range || !v.from, {
    message: 'Use either range or from+to, not both',
    path: ['range'],
  });
export type ReportExportQuery = z.infer<typeof ReportExportQuerySchema>;

// ---- Share links (11.2) ----

/** POST /reports/shares */
export const CreateReportShareRequestSchema = z
  .object({
    defaultRange: ReportRangeEnum.optional(),
    /** A fixed custom period (club dates, at most 366 days). Use instead of `defaultRange`. */
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .refine((v) => Boolean(v.from) === Boolean(v.to), { message: 'from and to must be provided together', path: ['to'] })
  .refine((v) => !v.defaultRange || !v.from, { message: 'Use either defaultRange or from+to, not both', path: ['defaultRange'] })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: 'to must not be before from', path: ['to'] })
  .refine((v) => !v.from || !v.to || Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`) <= 365 * 86_400_000, { message: 'A shared period can span at most 366 days', path: ['to'] });
export type CreateReportShareRequest = z.infer<typeof CreateReportShareRequestSchema>;

export const CreateReportShareResponseSchema = z.object({
  id: UuidSchema,
  from: DateOnlySchema.nullable().optional(),
  to: DateOnlySchema.nullable().optional(),
  url: z.string().url(),
  token: z.string().min(1),
  defaultRange: ReportRangeEnum,
  expiresAt: IsoDateTimeOutSchema,
});
export type CreateReportShareResponse = z.infer<typeof CreateReportShareResponseSchema>;

/** GET /reports/shares items (never the token). */
export const ReportShareSchema = z.object({
  id: UuidSchema,
  from: DateOnlySchema.nullable().optional(),
  to: DateOnlySchema.nullable().optional(),
  defaultRange: ReportRangeEnum,
  expiresAt: IsoDateTimeOutSchema,
  revokedAt: NullableIsoDateTimeOutSchema,
  createdAt: IsoDateTimeOutSchema,
});
export type ReportShare = z.infer<typeof ReportShareSchema>;
export const ReportShareListSchema = z.array(ReportShareSchema);

/** GET /public/reports/shared/:token params */
export const SharedReportParamSchema = z.object({
  token: z.string().min(1),
});

/** GET /public/reports/shared/:token query: optionally view another range than the link's default. */
export const SharedReportQuerySchema = z.object({ range: ReportRangeEnum.optional() });
export type SharedReportQuery = z.infer<typeof SharedReportQuerySchema>;

// ---- Domain breakdown (reports page sections) ----

const CountAmount = z.object({ count: z.number().int().min(0), amountPaise: PaiseSchema });

/** GET /reports/breakdown: one section per part of the club, for the same range as the dashboard. */
export const ReportBreakdownSchema = z.object({
  range: z.string(),
  from: DateOnlySchema,
  to: DateOnlySchema,
  generatedAt: IsoDateTimeOutSchema,
  bookings: z.object({
    total: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    bookedValuePaise: PaiseSchema,
    bySport: z.array(z.object({ sport: z.string(), count: z.number().int().min(0), amountPaise: PaiseSchema })),
    byChannel: z.array(z.object({ channel: z.string(), count: z.number().int().min(0) })),
    byCourt: z.array(z.object({ court: z.string(), count: z.number().int().min(0) })),
  }),
  orders: z.object({
    count: z.number().int().min(0),
    revenuePaise: PaiseSchema,
    byChannel: z.array(z.object({ channel: z.string() }).merge(CountAmount)),
    topProducts: z.array(z.object({ name: z.string(), qty: z.number().int(), amountPaise: PaiseSchema })),
  }),
  bar: z.object({
    tabsSettled: z.number().int().min(0),
    revenuePaise: PaiseSchema,
    averageTabPaise: PaiseSchema,
    topItems: z.array(z.object({ name: z.string(), qty: z.number().int(), amountPaise: PaiseSchema })),
  }),
  inventory: z.object({
    stockValuePaise: PaiseSchema,
    unitsSold: z.number().int().min(0),
    lowStock: z.array(z.object({ name: z.string(), sku: z.string(), stockQty: z.number().int(), reorderLevel: z.number().int() })),
  }),
  members: z.object({
    newMembers: z.number().int().min(0),
    activeMemberships: z.number().int().min(0),
    expiringSoon: z.number().int().min(0),
    byPlan: z.array(z.object({ plan: z.string(), active: z.number().int().min(0) })),
  }),
  payroll: z.object({
    activeEmployees: z.number().int().min(0),
    monthlyPayrollPaise: PaiseSchema,
    pendingLeave: z.number().int().min(0),
    byDepartment: z.array(z.object({ department: z.string(), employees: z.number().int().min(0), monthlyPaise: PaiseSchema })),
  }),
});
export type ReportBreakdown = z.infer<typeof ReportBreakdownSchema>;

// ---- Owner overview (dashboard "right now" panel) ----

/** GET /reports/overview: what is happening at the club at this moment. */
export const OwnerOverviewSchema = z.object({
  generatedAt: IsoDateTimeOutSchema,
  pendingOrders: z.number().int().min(0),
  openTabs: z.number().int().min(0),
  /** Exact number of people clocked in right now, however many are listed below. */
  staffOnShiftCount: z.number().int().min(0),
  upcomingBookings: z.array(
    z.object({
      id: UuidSchema,
      court: z.string(),
      sport: z.string(),
      startsAt: IsoDateTimeOutSchema,
      endsAt: IsoDateTimeOutSchema,
      who: z.string(),
    })
  ),
  staffOnShift: z.array(z.object({ name: z.string(), role: z.string(), since: IsoDateTimeOutSchema })),
  recentPayments: z.array(
    z.object({
      paidAt: IsoDateTimeOutSchema,
      source: RevenueSourceEnum,
      kind: z.enum(['PAYMENT', 'REFUND']),
      method: PaymentMethodSchema,
      amountPaise: PaiseSchema,
      who: z.string().nullable(),
    })
  ),
});
export type OwnerOverview = z.infer<typeof OwnerOverviewSchema>;

/** GET /reports/export.pdf: a server-generated PDF of the summary or the per-area breakdown. */
export const ReportPdfQuerySchema = z
  .object({
    range: ReportRangeEnum.optional(),
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
    type: z.enum(['summary', 'breakdown']).default('summary'),
  })
  .refine((v) => Boolean(v.from) === Boolean(v.to), { message: 'from and to must be provided together', path: ['to'] })
  .refine((v) => !v.range || !v.from, { message: 'Use either range or from+to, not both', path: ['range'] })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: 'to must not be before from', path: ['to'] });
export type ReportPdfQuery = z.infer<typeof ReportPdfQuerySchema>;
