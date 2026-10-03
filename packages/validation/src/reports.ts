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
    type: z.enum(['summary', 'payments']).default('summary'),
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
export const CreateReportShareRequestSchema = z.object({
  defaultRange: ReportRangeEnum.optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type CreateReportShareRequest = z.infer<typeof CreateReportShareRequestSchema>;

export const CreateReportShareResponseSchema = z.object({
  id: UuidSchema,
  url: z.string().url(),
  token: z.string().min(1),
  defaultRange: ReportRangeEnum,
  expiresAt: IsoDateTimeOutSchema,
});
export type CreateReportShareResponse = z.infer<typeof CreateReportShareResponseSchema>;

/** GET /reports/shares items (never the token). */
export const ReportShareSchema = z.object({
  id: UuidSchema,
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
