import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { runUnscoped } from '@packages/db';
import { requirePermission } from '@packages/iam';
import {
  CreateTenantDomainRequestSchema,
  CreateTenantRequestSchema,
  HttpErrorResponseSchema,
  TenantBrandingSchema,
  TenantDomainDetailSchema,
  TenantDomainListSchema,
  TenantSiteSchema,
  TenantSummaryListSchema,
  TenantSummarySchema,
  UpdateTenantBrandingRequestSchema,
  UpdateTenantStatusRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { TenantService } from '../../services/tenant.service.js';

const err = HttpErrorResponseSchema;
const IdParams = z.object({ id: UuidSchema });

/** Only the platform operator (the ROOT identity) manages clubs themselves. */
const rootOnly = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required to access this resource', code: 'UNAUTHORIZED', requestId: request.id, timestamp: new Date().toISOString() });
  }
  if (request.user.identityType !== 'ROOT') {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the platform operator can do this.', code: 'FORBIDDEN', requestId: request.id, timestamp: new Date().toISOString() });
  }
};

/**
 * Tenant control plane: the site and branding of the club serving the request, its domains with DNS
 * verification, and the platform operator's club management.
 */
export const tenantRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new TenantService(fastify.db, fastify.tenantDirectory, () => fastify.dnsVerifier, {
    platformDomain: fastify.env.PLATFORM_DOMAIN,
    cnameTarget: fastify.env.PLATFORM_CNAME_TARGET,
  });
  const manage = [requirePermission('admin:access')];
  const audit = (request: FastifyRequest, action: string, target: string, details: Record<string, unknown> = {}) =>
    fastify.iamService.logAuditEvent({ action, actor: request.user!.id, target, details: { tenantId: request.tenantId, ...details } });

  // ---------------------------------------------------------------- public: site and branding
  fastify.get(
    '/tenant',
    { schema: { description: 'The club this address belongs to, with its branding.', tags: ['Tenant'], response: { 200: TenantSiteSchema, 404: err } } },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await service.site(request.tenantId))
  );

  fastify.get(
    '/tenant/branding',
    { schema: { description: "The club's logo and colour palette.", tags: ['Tenant'], response: { 200: TenantBrandingSchema } } },
    async (request, reply) => reply.send(await service.branding(request.tenantId))
  );

  fastify.put(
    '/tenant/branding',
    {
      preHandler: manage,
      schema: {
        description: 'Change the logo or palette. Colours are validated hex values; null clears one.',
        tags: ['Tenant'],
        body: UpdateTenantBrandingRequestSchema,
        response: { 200: TenantBrandingSchema, 400: err, 401: err, 403: err },
      },
    },
    async (request, reply) => {
      const result = await service.updateBranding(request.tenantId, request.body);
      await audit(request, 'TENANT_BRANDING_UPDATED', request.tenantId, { fields: Object.keys(request.body) });
      return reply.send(result);
    }
  );

  // ---------------------------------------------------------------- domains
  fastify.get(
    '/tenant/domains',
    { preHandler: manage, schema: { description: "The club's domains and the DNS records each needs.", tags: ['Tenant'], response: { 200: TenantDomainListSchema, 401: err, 403: err } } },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await service.listDomains(request.tenantId))
  );

  fastify.post(
    '/tenant/domains',
    {
      preHandler: manage,
      schema: {
        description: 'Connect a custom domain. Returns the DNS records to create before verifying.',
        tags: ['Tenant'],
        body: CreateTenantDomainRequestSchema,
        response: { 201: TenantDomainDetailSchema, 400: err, 401: err, 403: err, 409: err, 422: err },
      },
    },
    async (request, reply) => {
      const created = await service.addDomain(request.tenantId, request.body.domain);
      await audit(request, 'TENANT_DOMAIN_ADDED', created.id, { domain: created.domain });
      return reply.status(201).send(created);
    }
  );

  fastify.get(
    '/tenant/domains/:id',
    { preHandler: manage, schema: { description: 'Verification status of one domain.', tags: ['Tenant'], params: IdParams, response: { 200: TenantDomainDetailSchema, 401: err, 403: err, 404: err } } },
    async (request, reply) => reply.header('cache-control', 'no-store').send(await service.getDomain(request.tenantId, request.params.id))
  );

  fastify.post(
    '/tenant/domains/:id/verify',
    {
      preHandler: manage,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { description: 'Check the DNS records now. Rate limited.', tags: ['Tenant'], params: IdParams, response: { 200: TenantDomainDetailSchema, 401: err, 403: err, 404: err, 429: err } },
    },
    async (request, reply) => {
      const result = await service.verifyDomain(request.tenantId, request.params.id);
      await audit(request, 'TENANT_DOMAIN_VERIFY_ATTEMPT', result.id, { domain: result.domain, status: result.status });
      return reply.header('cache-control', 'no-store').send(result);
    }
  );

  fastify.delete(
    '/tenant/domains/:id',
    { preHandler: manage, schema: { description: 'Disconnect a custom domain.', tags: ['Tenant'], params: IdParams, response: { 204: z.null(), 401: err, 403: err, 404: err, 422: err } } },
    async (request, reply) => {
      await service.removeDomain(request.tenantId, request.params.id);
      await audit(request, 'TENANT_DOMAIN_REMOVED', request.params.id);
      return reply.status(204).send(null);
    }
  );

  // ---------------------------------------------------------------- platform operator
  fastify.get(
    '/platform/tenants',
    { preHandler: [rootOnly], schema: { description: 'All clubs (platform operator).', tags: ['Platform'], response: { 200: TenantSummaryListSchema, 401: err, 403: err } } },
    async (_request, reply) => reply.send(await runUnscoped(async () => service.listTenants()))
  );

  fastify.post(
    '/platform/tenants',
    {
      preHandler: [rootOnly],
      schema: { description: 'Create a club with its platform address and empty branding.', tags: ['Platform'], body: CreateTenantRequestSchema, response: { 201: TenantSummarySchema, 400: err, 401: err, 403: err, 409: err } },
    },
    async (request, reply) => {
      const tenant = await runUnscoped(async () => service.createTenant(request.body));
      await audit(request, 'PLATFORM_TENANT_CREATED', tenant.id, { slug: tenant.slug });
      return reply.status(201).send(tenant);
    }
  );

  fastify.put(
    '/platform/tenants/:id/status',
    {
      preHandler: [rootOnly],
      schema: { description: 'Suspend or reactivate a club.', tags: ['Platform'], params: IdParams, body: UpdateTenantStatusRequestSchema, response: { 200: TenantSummarySchema, 400: err, 401: err, 403: err, 404: err } },
    },
    async (request, reply) => {
      const tenant = await runUnscoped(async () => service.setStatus(request.params.id, request.body.status));
      await audit(request, 'PLATFORM_TENANT_STATUS', tenant.id, { status: tenant.status });
      return reply.send(tenant);
    }
  );
};
