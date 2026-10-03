import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  BusinessClientListQuerySchema,
  BusinessClientPageSchema,
  BusinessClientSchema,
  CreateBusinessClientRequestSchema,
  CreateInvoiceRequestSchema,
  HttpErrorResponseSchema,
  InvoiceDetailSchema,
  InvoiceListQuerySchema,
  InvoicePageSchema,
  InvoiceSchema,
  LedgerPaymentPageSchema,
  PayInvoiceRequestSchema,
  PayInvoiceResponseSchema,
  PaymentListQuerySchema,
  TaxSummaryQuerySchema,
  TaxSummarySchema,
  UpdateBusinessClientRequestSchema,
  UuidSchema,
  VoidInvoiceRequestSchema,
} from '@packages/validation';
import { can } from '../../lib/authz.js';
import { DomainError } from '../../lib/domain-error.js';
import { FinanceService } from '../../services/finance.service.js';

const IdParam = z.object({ id: UuidSchema });
const authErrors = { 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema };
const errors = {
  400: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema,
  409: HttpErrorResponseSchema,
  422: HttpErrorResponseSchema,
  ...authErrors,
};

/** Invoices, business clients, payments ledger and tax summary (API_CONTRACT.md section 10.1 and 10.2). */
export const financeRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new FinanceService(fastify.db, fastify.env.CLUB_TIMEZONE);

  // ------------------------------------------------------------------- invoices

  fastify.get(
    '/invoices',
    {
      preHandler: [requirePermission('invoices:read')],
      schema: {
        description: 'List invoices (front desk, owner). `overdue=true` means sent and past the due date.',
        tags: ['Finance'],
        querystring: InvoiceListQuerySchema,
        response: { 200: InvoicePageSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listInvoices(request.query))
  );

  fastify.post(
    '/invoices',
    {
      preHandler: [requirePermission('invoices:create')],
      schema: {
        description: 'Create a DRAFT invoice for a member or a business client. Prices include tax.',
        tags: ['Finance'],
        body: CreateInvoiceRequestSchema,
        response: { 201: InvoiceSchema, ...errors },
      },
    },
    async (request, reply) => {
      const invoice = await service.createInvoice(request.body, request.user!.id);
      request.log.info({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, actorId: request.user!.id }, 'Invoice created');
      return reply.status(201).send(invoice);
    }
  );

  fastify.get(
    '/invoices/:id',
    {
      // Staff read any invoice; a member may read only their own (checked below against the member's login).
      preHandler: [
        async (request, reply) => {
          if (!request.user) {
            return reply.status(401).send({
              statusCode: 401,
              error: 'Unauthorized',
              message: 'Authentication required to access this resource',
              code: 'UNAUTHORIZED',
              requestId: request.id,
              timestamp: new Date().toISOString(),
            });
          }
          if ((await can(request, 'invoices:read')) || (await can(request, 'invoices:read:self', request.user.id))) return;
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: "You do not have permission to perform 'invoices:read'",
            code: 'FORBIDDEN',
            requestId: request.id,
            timestamp: new Date().toISOString(),
          });
        },
      ],
      schema: {
        description: 'One invoice with its payments. Members may read only their own.',
        tags: ['Finance'],
        params: IdParam,
        response: { 200: InvoiceDetailSchema, ...errors },
      },
    },
    async (request, reply) => {
      const owner = await service.ownerOf(request.params.id);
      if (!owner.exists) throw new DomainError('NOT_FOUND', 404, 'Invoice not found.');
      if (!(await can(request, 'invoices:read')) && !(await can(request, 'invoices:read:self', owner.memberUserId))) {
        // Another member's invoice is indistinguishable from a missing one.
        throw new DomainError('NOT_FOUND', 404, 'Invoice not found.');
      }
      return reply.send(await service.getInvoice(request.params.id));
    }
  );

  fastify.post(
    '/invoices/:id/send',
    {
      preHandler: [requirePermission('invoices:create')],
      schema: {
        description: 'Mark a DRAFT invoice as sent. Email delivery is not connected.',
        tags: ['Finance'],
        params: IdParam,
        response: { 200: InvoiceSchema, ...errors },
      },
    },
    async (request, reply) => {
      const invoice = await service.sendInvoice(request.params.id);
      request.log.info({ invoiceId: invoice.id, actorId: request.user!.id }, 'Invoice marked sent; email delivery is disabled');
      return reply.send(invoice);
    }
  );

  fastify.post(
    '/invoices/:id/pay',
    {
      preHandler: [requirePermission('payments:create')],
      schema: {
        description: 'Take a payment against a SENT invoice (default: the full balance). It becomes PAID at zero balance.',
        tags: ['Finance'],
        params: IdParam,
        body: PayInvoiceRequestSchema,
        response: { 200: PayInvoiceResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.payInvoice(request.params.id, request.body, request.user!.id);
      request.log.info(
        { invoiceId: result.invoice.id, paymentId: result.payment.id, amountPaise: result.payment.amountPaise, actorId: request.user!.id },
        'Invoice payment recorded'
      );
      return reply.send(result);
    }
  );

  fastify.post(
    '/invoices/:id/void',
    {
      preHandler: [requirePermission('invoices:update')],
      schema: {
        description: 'Void an unpaid invoice (owner). The reason is written to the audit log.',
        tags: ['Finance'],
        params: IdParam,
        body: VoidInvoiceRequestSchema,
        response: { 200: InvoiceSchema, ...errors },
      },
    },
    async (request, reply) => {
      const invoice = await service.voidInvoice(request.params.id);
      request.log.info({ invoiceId: invoice.id, actorId: request.user!.id }, 'Invoice voided');
      await fastify.iamService.logAuditEvent({
        action: 'INVOICE_VOIDED',
        actor: request.user!.id,
        target: invoice.id,
        details: { reason: request.body.reason, invoiceNumber: invoice.invoiceNumber },
      });
      return reply.send(invoice);
    }
  );

  // ----------------------------------------------------------- business clients

  fastify.get(
    '/business-clients',
    {
      preHandler: [requirePermission('invoices:read')],
      schema: {
        description: 'Business clients with what they still owe on sent invoices.',
        tags: ['Finance'],
        querystring: BusinessClientListQuerySchema,
        response: { 200: BusinessClientPageSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listClients(request.query))
  );

  fastify.post(
    '/business-clients',
    {
      preHandler: [requirePermission('invoices:create')],
      schema: {
        description: 'Add a business client to invoice.',
        tags: ['Finance'],
        body: CreateBusinessClientRequestSchema,
        response: { 201: BusinessClientSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => {
      const client = await service.createClient(request.body);
      request.log.info({ clientId: client.id, actorId: request.user!.id }, 'Business client created');
      return reply.status(201).send(client);
    }
  );

  fastify.put(
    '/business-clients/:id',
    {
      preHandler: [requirePermission('invoices:create')],
      schema: {
        description: 'Change any subset of a business client.',
        tags: ['Finance'],
        params: IdParam,
        body: UpdateBusinessClientRequestSchema,
        response: { 200: BusinessClientSchema, ...errors },
      },
    },
    async (request, reply) => reply.send(await service.updateClient(request.params.id, request.body))
  );

  // ------------------------------------------------------------ ledger and tax

  fastify.get(
    '/payments',
    {
      preHandler: [requirePermission('payments:read')],
      schema: {
        description: 'The payments ledger, newest first (owner).',
        tags: ['Finance'],
        querystring: PaymentListQuerySchema,
        response: { 200: LedgerPaymentPageSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.listPayments(request.query))
  );

  fastify.get(
    '/finance/tax-summary',
    {
      preHandler: [requirePermission('payments:read')],
      schema: {
        description: 'Tax portion of revenue by source for a date range (simplified: inclusive rates per source).',
        tags: ['Finance'],
        querystring: TaxSummaryQuerySchema,
        response: { 200: TaxSummarySchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await service.taxSummary(request.query))
  );
};
