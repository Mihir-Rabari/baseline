import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CategoryScope } from '@packages/db';
import { authorize, requirePermission } from '@packages/iam';
import {
  CategoryListQuerySchema,
  CategoryListSchema,
  CategorySchema,
  CreateCategoryRequestSchema,
  HttpErrorResponseSchema,
  UpdateCategoryRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { CategoryService } from '../../services/category.service.js';

const err = HttpErrorResponseSchema;
const IdParams = z.object({ id: UuidSchema });
const UsageSchema = z.record(z.string(), z.number().int());

/**
 * Managed category lists. Product categories follow the shop permissions (`products:*`); menu
 * categories follow the bar's owner-only rule (`bar:manage` + `reports:read`).
 */
export const categoryRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new CategoryService(fastify.db);

  const scopes: Array<{
    scope: CategoryScope;
    base: string;
    tag: string;
    read: ReturnType<typeof requirePermission>[];
    create: ReturnType<typeof requirePermission>[];
    update: ReturnType<typeof requirePermission>[];
    /** Permissions that also let the caller see switched-off categories. */
    manage: string[];
  }> = [
    {
      scope: 'PRODUCT',
      base: '/products/categories',
      tag: 'Shop',
      read: [requirePermission('products:read')],
      create: [requirePermission('products:create')],
      update: [requirePermission('products:update')],
      manage: ['products:update'],
    },
    {
      scope: 'MENU',
      base: '/bar/categories',
      tag: 'Bar',
      read: [requirePermission('bar:read')],
      create: [requirePermission('bar:manage'), requirePermission('reports:read')],
      update: [requirePermission('bar:manage'), requirePermission('reports:read')],
      manage: ['bar:manage', 'reports:read'],
    },
  ];

  for (const s of scopes) {
    fastify.get(
      s.base,
      {
        preHandler: s.read,
        schema: {
          description: `List ${s.scope.toLowerCase()} categories (search with ?q=). Switched-off ones only for managers.`,
          tags: [s.tag],
          querystring: CategoryListQuerySchema,
          response: { 200: CategoryListSchema, 400: err, 401: err, 403: err },
        },
      },
      async (request, reply) => {
        // Only managers may see switched-off rows; everyone else silently gets the active list.
        const statements = (request.effectiveStatements ?? []) as Parameters<typeof authorize>[2];
        const includeInactive =
          request.query.includeInactive === 'true' &&
          s.manage.every((action) => authorize(request.user as Parameters<typeof authorize>[0], action, statements).allowed);
        return reply.status(200).send(await service.list(s.scope, { q: request.query.q, includeInactive }));
      }
    );

    fastify.get(
      `${s.base}/usage`,
      {
        preHandler: s.update,
        schema: {
          description: 'Items per category code, so managers can see what is in use',
          tags: [s.tag],
          response: { 200: UsageSchema, 401: err, 403: err },
        },
      },
      async (_request, reply) => reply.status(200).send(await service.usage(s.scope))
    );

    fastify.post(
      s.base,
      {
        preHandler: s.create,
        schema: {
          description: `Add a ${s.scope.toLowerCase()} category`,
          tags: [s.tag],
          body: CreateCategoryRequestSchema,
          response: { 201: CategorySchema, 400: err, 401: err, 403: err, 409: err },
        },
      },
      async (request, reply) => {
        const row = await service.create(s.scope, request.body);
        await fastify.iamService.logAuditEvent({
          action: 'CATEGORY_CREATED',
          actor: request.user!.id,
          target: row.id,
          details: { scope: s.scope, code: row.code },
        });
        return reply.status(201).send(row);
      }
    );

    fastify.put(
      `${s.base}/:id`,
      {
        preHandler: s.update,
        schema: {
          description: 'Rename, reorder, or switch a category on or off. The code is permanent.',
          tags: [s.tag],
          params: IdParams,
          body: UpdateCategoryRequestSchema,
          response: { 200: CategorySchema, 400: err, 401: err, 403: err, 404: err },
        },
      },
      async (request, reply) => {
        const row = await service.update(s.scope, request.params.id, request.body);
        await fastify.iamService.logAuditEvent({
          action: 'CATEGORY_UPDATED',
          actor: request.user!.id,
          target: row.id,
          details: { scope: s.scope, fields: Object.keys(request.body) },
        });
        return reply.status(200).send(row);
      }
    );
  }

  // Storefront filter chips: no login, active product categories only.
  fastify.get(
    '/public/product-categories',
    {
      schema: {
        description: 'Active product categories for the public shop',
        tags: ['Public'],
        response: { 200: CategoryListSchema },
      },
    },
    async (_request, reply) => reply.status(200).send(await service.list('PRODUCT'))
  );
};
