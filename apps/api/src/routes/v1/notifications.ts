import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  HttpErrorResponseSchema,
  NotificationListQuerySchema,
  NotificationPageSchema,
  NotificationSchema,
  ReadAllResponseSchema,
  UnreadCountSchema,
  UuidSchema,
} from '@packages/validation';
import { NotificationService, type NotificationRow } from '../../services/notification.service.js';

function toDto(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * Every query is scoped to `request.user.id`, so these endpoints can only ever touch the
 * caller's own rows. The `:self` permissions are evaluated with the caller as resource owner.
 */
export const notificationRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new NotificationService(fastify.db);

  const selfGuard = (permission: 'notifications:read:self' | 'notifications:update:self') =>
    requirePermission(permission, (req) => ({ resourceOwnerId: req.user?.id }));

  fastify.get(
    '/notifications',
    {
      preHandler: [selfGuard('notifications:read:self')],
      schema: {
        description: "List the caller's notifications (newest first)",
        tags: ['Notifications'],
        querystring: NotificationListQuerySchema,
        response: {
          200: NotificationPageSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { page, limit, order, unread } = request.query;
      const { rows, total } = await service.list(request.user!.id, {
        unreadOnly: unread === 'true',
        page,
        limit,
        order,
      });
      const totalPages = Math.ceil(total / limit);
      return reply.status(200).send({
        data: rows.map(toDto),
        meta: {
          page,
          limit,
          totalItems: total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    }
  );

  fastify.get(
    '/notifications/unread-count',
    {
      preHandler: [selfGuard('notifications:read:self')],
      schema: {
        description: 'Number of unread notifications (the topbar bell polls this)',
        tags: ['Notifications'],
        response: {
          200: UnreadCountSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const count = await service.unreadCount(request.user!.id);
      return reply.status(200).send({ count });
    }
  );

  fastify.post(
    '/notifications/read-all',
    {
      preHandler: [selfGuard('notifications:update:self')],
      schema: {
        description: "Mark all of the caller's notifications as read",
        tags: ['Notifications'],
        response: {
          200: ReadAllResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const updated = await service.markAllRead(request.user!.id);
      return reply.status(200).send({ updated });
    }
  );

  fastify.post(
    '/notifications/:id/read',
    {
      preHandler: [selfGuard('notifications:update:self')],
      schema: {
        description: "Mark one of the caller's notifications as read",
        tags: ['Notifications'],
        params: z.object({ id: UuidSchema }),
        response: {
          200: NotificationSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const row = await service.markRead(request.user!.id, request.params.id);
      if (!row) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Notification not found',
          code: 'NOT_FOUND',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(200).send(toDto(row));
    }
  );
};
