import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  CreateReportShareRequestSchema,
  CreateReportShareResponseSchema,
  DashboardReportSchema,
  HttpErrorResponseSchema,
  ReportShareListSchema,
  UuidSchema,
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
import { ReportShareService } from '../../services/report-share.service.js';

const errors = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  403: HttpErrorResponseSchema,
};

/** Owner dashboard and exports (API_CONTRACT.md section 11). OWNER only via `reports:read`. */
export const reportRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const reports = new ReportService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const shares = new ReportShareService(fastify.db, fastify.env.WEB_URL);

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
  // ---------------------------------------------------------------------------
  // Share links (section 11.2). The public read side is GET /public/reports/shared/:token.
  // ---------------------------------------------------------------------------
  fastify.post(
    '/reports/shares',
    {
      preHandler: [requirePermission('reports:share')],
      schema: {
        description: 'Create a read-only dashboard link. The token is shown once; only its hash is stored.',
        tags: ['Reports'],
        security: [{ CookieAuth: [] }],
        body: CreateReportShareRequestSchema,
        response: { 201: CreateReportShareResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const share = await shares.create(request.body, request.user!.id);
      // Never log the token or the URL that contains it (AGENTS.md section 5).
      request.log.info({ shareId: share.id, expiresAt: share.expiresAt }, 'Report share created');
      await fastify.iamService.logAuditEvent({ action: 'REPORT_SHARE_CREATED', actor: request.user!.id, target: share.id });
      return reply.status(201).header('cache-control', 'no-store').send(share);
    }
  );

  fastify.get(
    '/reports/shares',
    {
      preHandler: [requirePermission('reports:share')],
      schema: {
        description: 'List share links (never the token), newest first.',
        tags: ['Reports'],
        security: [{ CookieAuth: [] }],
        response: { 200: ReportShareListSchema, 401: errors[401], 403: errors[403] },
      },
    },
    async (_request, reply) => reply.header('cache-control', 'no-store').send(await shares.list())
  );

  fastify.delete(
    '/reports/shares/:id',
    {
      preHandler: [requirePermission('reports:share')],
      schema: {
        description: 'Revoke a share link immediately.',
        tags: ['Reports'],
        security: [{ CookieAuth: [] }],
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.object({ success: z.literal(true), message: z.string() }),
          ...errors,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await shares.revoke(request.params.id);
      request.log.info({ shareId: request.params.id }, 'Report share revoked');
      await fastify.iamService.logAuditEvent({ action: 'REPORT_SHARE_REVOKED', actor: request.user!.id, target: request.params.id });
      return reply.send({ success: true as const, message: 'Share link revoked' });
    }
  );
};
