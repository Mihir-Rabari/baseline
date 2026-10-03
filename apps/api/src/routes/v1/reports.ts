import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requirePermission } from '@packages/iam';
import {
  DashboardReportSchema,
  HttpErrorResponseSchema,
  ReportExportQuerySchema,
  ReportRangeQuerySchema,
} from '@packages/validation';
import {
  ReportService,
  exportFilename,
  paymentsCsvRows,
  summaryCsvRows,
  toCsv,
  type ResolvedRange,
} from '../../services/report.service.js';

const errors = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  403: HttpErrorResponseSchema,
};

/** Owner dashboard and exports (API_CONTRACT.md section 11). OWNER only via `reports:read`. */
export const reportRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const reports = new ReportService(fastify.db, fastify.env.CLUB_TIMEZONE);

  fastify.get(
    '/reports/dashboard',
    {
      preHandler: [requirePermission('reports:read')],
      schema: {
        description:
          'Live owner dashboard: revenue (net of refunds) by source, method and time, what the club owes, and alerts. `range` or `from`+`to`.',
        tags: ['Reports'],
        security: [{ CookieAuth: [] }],
        querystring: ReportRangeQuerySchema,
        response: { 200: DashboardReportSchema, ...errors },
      },
    },
    async (request, reply) => {
      const report = await reports.dashboard(request.query);
      request.log.info({ range: report.range, from: report.from, to: report.to }, 'Dashboard report generated');
      return reply.header('cache-control', 'no-store').send(report);
    }
  );

  fastify.get(
    '/reports/export.csv',
    {
      preHandler: [requirePermission('reports:read')],
      schema: {
        description: 'CSV export of the dashboard (`type=summary`, default) or the raw ledger rows (`type=payments`).',
        tags: ['Reports'],
        security: [{ CookieAuth: [] }],
        querystring: ReportExportQuerySchema,
        response: errors,
      },
    },
    async (request, reply) => {
      const { type, ...input } = request.query;
      let csv: string;
      let filename: string;
      if (type === 'payments') {
        const { range, rows, truncated } = await reports.paymentRows(input);
        csv = toCsv(paymentsCsvRows(rows));
        filename = exportFilename(range, 'payments');
        if (truncated) reply.header('x-export-truncated', 'true');
      } else {
        const report = await reports.dashboard(input);
        csv = toCsv(summaryCsvRows(report));
        filename = exportFilename(
          { label: report.range as ResolvedRange['label'], from: report.from, to: report.to },
          'summary'
        );
      }
      request.log.info({ type, filename }, 'Report exported');
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'no-store')
        // The 200 body is plain text, which has no response schema; the typed reply only knows errors.
        .send(csv as never);
    }
  );
};
