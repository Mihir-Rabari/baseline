import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  UuidSchema, HttpErrorResponseSchema, LeadListQuerySchema, LeadPageSchema, CrmSummarySchema,
  CreateLeadRequestSchema, LeadSchema, LeadDetailSchema, UpdateLeadRequestSchema,
  CreateLeadActivityRequestSchema, LeadActivitySchema, CreateQuoteRequestSchema, QuoteSchema,
  UpdateQuoteRequestSchema, ConvertLeadRequestSchema, ConvertLeadResponseSchema,
} from '@packages/validation';
import { CrmService } from '../../services/crm.service.js';
const params = z.object({ id: UuidSchema });
const errors = { 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, 422: HttpErrorResponseSchema };
export const crmRoutes: FastifyPluginAsyncZod = async fastify => {
  const service = new CrmService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const read = [requirePermission('crm:read')], manage = [requirePermission('crm:manage')];
  fastify.get('/crm/leads', { preHandler: read, schema: { tags: ['CRM'], querystring: LeadListQuerySchema, response: { 200: LeadPageSchema, ...errors } } },
    async request => service.list(request.query));
  fastify.get('/crm/summary', { preHandler: read, schema: { tags: ['CRM'], response: { 200: CrmSummarySchema, ...errors } } },
    async () => service.summary());
  fastify.post('/crm/leads', { preHandler: manage, schema: { tags: ['CRM'], body: CreateLeadRequestSchema, response: { 201: LeadSchema, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.createLead(request.body, request.user!.id)));
  fastify.get('/crm/leads/:id', { preHandler: read, schema: { tags: ['CRM'], params, response: { 200: LeadDetailSchema, ...errors } } },
    async request => service.detail(request.params.id));
  fastify.patch('/crm/leads/:id', { preHandler: manage, schema: { tags: ['CRM'], params, body: UpdateLeadRequestSchema, response: { 200: LeadSchema, ...errors } } },
    async request => service.updateLead(request.params.id, request.body, request.user!.id));
  fastify.post('/crm/leads/:id/activities', { preHandler: manage, schema: { tags: ['CRM'], params, body: CreateLeadActivityRequestSchema, response: { 201: LeadActivitySchema, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.addActivity(request.params.id, request.body, request.user!.id)));
  fastify.post('/crm/leads/:id/quotes', { preHandler: manage, schema: { tags: ['CRM'], params, body: CreateQuoteRequestSchema, response: { 201: QuoteSchema, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.createQuote(request.params.id, request.body, request.user!.id)));
  fastify.post('/crm/quotes/:id/send', { preHandler: manage, schema: { tags: ['CRM'], params, response: { 200: QuoteSchema, ...errors } } },
    async request => {
      const quote = await service.sendQuote(request.params.id, request.user!.id);
      request.log.info({ quoteId: quote.id }, 'Quote marked sent; email delivery is disabled');
      return quote;
    });
  fastify.patch('/crm/quotes/:id', { preHandler: manage, schema: { tags: ['CRM'], params, body: UpdateQuoteRequestSchema, response: { 200: QuoteSchema, ...errors } } },
    async request => service.updateQuote(request.params.id, request.body));
  fastify.post('/crm/leads/:id/convert', { preHandler: manage, schema: { tags: ['CRM'], params, body: ConvertLeadRequestSchema, response: { 201: ConvertLeadResponseSchema, ...errors } } },
    async (request, reply) => {
      const result = await service.convert(request.params.id, request.body, request.user!.id);
      void fastify.accountService
        .provisionMemberLogin({ id: result.member.id, fullName: result.member.fullName, email: result.member.email, planName: result.member.membership?.plan.name })
        .catch((error: unknown) => request.log.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'Member login email failed'));
      return reply.status(201).send(result);
    });
};
