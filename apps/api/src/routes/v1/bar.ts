import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authorize, requirePermission } from '@packages/iam';
import {
  AddTabItemRequestSchema,
  UpdateTabItemRequestSchema,
  BarEarningsQuerySchema,
  BarEarningsSchema,
  BarTableListSchema,
  BarTableQuerySchema,
  BarTableSchema,
  CreateBarTableRequestSchema,
  CreateMenuItemRequestSchema,
  DeleteBarTableResponseSchema,
  UpdateBarTableRequestSchema,
  CreateTableBookingRequestSchema,
  TableBookingListSchema,
  TableBookingQuerySchema,
  TableBookingSchema,
  UpdateTableBookingRequestSchema,
  HttpErrorResponseSchema,
  MenuItemListSchema,
  MenuItemSchema,
  MenuQuerySchema,
  OpenTabRequestSchema,
  SendTabResponseSchema,
  SettleTabRequestSchema,
  SettleTabResponseSchema,
  TabItemParamSchema,
  TabListQuerySchema,
  TabSchema,
  TabSummaryPageSchema,
  TicketListQuerySchema,
  TicketListSchema,
  TicketSchema,
  UpdateMenuItemRequestSchema,
  UpdateTicketStatusRequestSchema,
  UuidSchema,
  VoidTabRequestSchema,
} from '@packages/validation';
import { DomainError } from '../../lib/domain-error.js';
import { BarService } from '../../services/bar.service.js';
import { TableBookingService } from '../../services/table-booking.service.js';

const IdParams = z.object({ id: UuidSchema });

const err = HttpErrorResponseSchema;
const authErrors = { 401: err, 403: err } as const;

/**
 * Bar POS: tables, menu, tabs, kitchen tickets and earnings (API_CONTRACT section 7).
 *
 * BAR_STAFF and OWNER hold `bar:*`. Owner-only actions (menu editing, voiding a tab, removing an
 * item already sent, browsing other days of earnings) are identified by `reports:read`, which
 * OWNER holds and BAR_STAFF does not.
 *
 * FRONT_DESK holds no `bar:read`, so the contract's "FD can read tables and menu" is not granted;
 * widening FRONT_DESK would also expose tabs and earnings.
 */
export const barRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new BarService(fastify.db);
  const bookings = new TableBookingService(fastify.db);
  const ownerOnly = [requirePermission('bar:manage'), requirePermission('reports:read')];

  const isOwner = (request: { user?: unknown; effectiveStatements?: unknown }): boolean =>
    authorize(
      request.user as Parameters<typeof authorize>[0],
      'reports:read',
      (request.effectiveStatements ?? []) as Parameters<typeof authorize>[2]
    ).allowed;

  // ---------------------------------------------------------- tables, menu

  fastify.get(
    '/bar/tables',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'Bar tables with their open tab, if any. Owners may pass includeInactive=true.',
        tags: ['Bar'],
        querystring: BarTableQuerySchema,
        response: { 200: BarTableListSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) =>
      reply
        .status(200)
        .send(await service.listTables({ includeInactive: request.query.includeInactive === 'true' && isOwner(request) }))
  );

  fastify.post(
    '/bar/tables',
    {
      preHandler: ownerOnly,
      schema: {
        description: 'Add a bar table (owner)',
        tags: ['Bar'],
        body: CreateBarTableRequestSchema,
        response: { 201: BarTableSchema.omit({ status: true, openTab: true }), 400: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const table = await service.createTable(request.body);
      await fastify.iamService.logAuditEvent({ action: 'BAR_TABLE_CREATED', actor: request.user!.id, target: table.id, details: { name: table.name, seats: table.seats } });
      request.log.info({ tableId: table.id, actorId: request.user!.id }, 'Bar table created');
      return reply.status(201).send(table);
    }
  );

  fastify.put(
    '/bar/tables/:id',
    {
      preHandler: ownerOnly,
      schema: {
        description: 'Rename a bar table, change its seats or switch it on or off (owner)',
        tags: ['Bar'],
        params: IdParams,
        body: UpdateBarTableRequestSchema,
        response: { 200: BarTableSchema.omit({ status: true, openTab: true }), 400: err, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const table = await service.updateTable(request.params.id, request.body);
      await fastify.iamService.logAuditEvent({ action: 'BAR_TABLE_UPDATED', actor: request.user!.id, target: table.id, details: { fields: Object.keys(request.body) } });
      request.log.info({ tableId: table.id, actorId: request.user!.id }, 'Bar table updated');
      return reply.status(200).send(table);
    }
  );

  fastify.delete(
    '/bar/tables/:id',
    {
      preHandler: ownerOnly,
      schema: {
        description: 'Remove a bar table (owner). A table with past tabs is switched off instead of deleted.',
        tags: ['Bar'],
        params: IdParams,
        response: { 200: DeleteBarTableResponseSchema, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const { name, ...result } = await service.deleteTable(request.params.id);
      await fastify.iamService.logAuditEvent({ action: 'BAR_TABLE_REMOVED', actor: request.user!.id, target: request.params.id, details: { name, ...result } });
      request.log.warn({ tableId: request.params.id, actorId: request.user!.id, ...result }, 'Bar table removed');
      return reply.status(200).send(result);
    }
  );

  fastify.get(
    '/bar/menu',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'Menu items, optionally filtered by category',
        tags: ['Bar'],
        querystring: MenuQuerySchema,
        response: { 200: MenuItemListSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => reply.status(200).send(await service.listMenu(request.query.category))
  );

  fastify.get(
    '/menu',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'Menu items alias',
        tags: ['Bar'],
        querystring: MenuQuerySchema,
        response: { 200: MenuItemListSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => reply.status(200).send(await service.listMenu(request.query.category))
  );

  fastify.post(
    '/bar/menu',
    {
      preHandler: ownerOnly,
      schema: {
        description: 'Add a menu item (owner)',
        tags: ['Bar'],
        body: CreateMenuItemRequestSchema,
        response: { 201: MenuItemSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const item = await service.createMenuItem(request.body);
      request.log.info({ menuItemId: item.id, actorId: request.user!.id }, 'Menu item created');
      return reply.status(201).send(item);
    }
  );

  fastify.put(
    '/bar/menu/:id',
    {
      preHandler: ownerOnly,
      schema: {
        description: 'Edit a menu item or toggle its availability (owner)',
        tags: ['Bar'],
        params: IdParams,
        body: UpdateMenuItemRequestSchema,
        response: { 200: MenuItemSchema, 400: err, 404: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const item = await service.updateMenuItem(request.params.id, request.body);
      request.log.info({ menuItemId: item.id, actorId: request.user!.id }, 'Menu item updated');
      return reply.status(200).send(item);
    }
  );

  // ------------------------------------------------------------------ tabs

  fastify.post(
    '/bar/tabs',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Open a tab for a member or a guest, optionally at a table',
        tags: ['Bar'],
        body: OpenTabRequestSchema,
        response: { 201: TabSchema, 400: err, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const tab = await service.openTab(request.body, request.user!.id);
      request.log.info({ tabId: tab.id, tabNumber: tab.tabNumber, actorId: request.user!.id }, 'Bar tab opened');
      return reply.status(201).send(tab);
    }
  );

  fastify.get(
    '/bar/tabs',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'Tabs by status (default OPEN), without line items',
        tags: ['Bar'],
        querystring: TabListQuerySchema,
        response: { 200: TabSummaryPageSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const { rows, total } = await service.listTabs(request.query);
      const { page, limit } = request.query;
      const totalPages = Math.ceil(total / limit);
      return reply.status(200).send({
        data: rows,
        meta: { page, limit, totalItems: total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
      });
    }
  );

  fastify.get(
    '/bar/tabs/:id',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'One tab with its line items',
        tags: ['Bar'],
        params: IdParams,
        response: { 200: TabSchema, 404: err, ...authErrors },
      },
    },
    async (request, reply) => reply.status(200).send(await service.getTab(request.params.id))
  );

  fastify.post(
    '/bar/tabs/:id/items',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Add an item; the member bar discount is applied automatically',
        tags: ['Bar'],
        params: IdParams,
        body: AddTabItemRequestSchema,
        response: { 200: TabSchema, 400: err, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) =>
      reply.status(200).send(await service.addItem(request.params.id, request.body, request.user!.id))
  );

  fastify.patch(
    '/bar/tabs/:id/items/:itemId',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Set the quantity of a PENDING item (items already sent to the kitchen are fixed)',
        tags: ['Bar'],
        params: TabItemParamSchema,
        body: UpdateTabItemRequestSchema,
        response: { 200: TabSchema, 400: err, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const tab = await service.updateItemQty(request.params.id, request.params.itemId, request.body.qty);
      request.log.info(
        { tabId: tab.id, itemId: request.params.itemId, qty: request.body.qty, actorId: request.user!.id },
        'Bar tab item quantity updated'
      );
      return reply.status(200).send(tab);
    }
  );

  fastify.delete(
    '/bar/tabs/:id/items/:itemId',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Remove an item (bar staff while PENDING, owner at any time)',
        tags: ['Bar'],
        params: TabItemParamSchema,
        response: { 200: TabSchema, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const tab = await service.removeItem(request.params.id, request.params.itemId, isOwner(request));
      request.log.info(
        { tabId: tab.id, itemId: request.params.itemId, actorId: request.user!.id },
        'Bar tab item removed'
      );
      return reply.status(200).send(tab);
    }
  );

  fastify.post(
    '/bar/tabs/:id/send',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Send all PENDING items to the kitchen, one ticket per station',
        tags: ['Bar'],
        params: IdParams,
        response: { 200: SendTabResponseSchema, 404: err, 409: err, 422: err, ...authErrors },
      },
    },
    async (request, reply) => reply.status(200).send(await service.sendToKitchen(request.params.id, request.user!.id))
  );

  fastify.post(
    '/bar/tabs/:id/settle',
    {
      preHandler: [requirePermission('bar:settle')],
      schema: {
        description: 'Settle a tab once, taking one or several payments',
        tags: ['Bar'],
        params: IdParams,
        body: SettleTabRequestSchema,
        response: { 200: SettleTabResponseSchema, 400: err, 404: err, 409: err, 422: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const result = await service.settle(request.params.id, request.body, request.user!.id);
      request.log.info(
        { tabId: result.tab.id, totalPaise: result.receipt.totalPaise, actorId: request.user!.id },
        'Bar tab settled'
      );
      return reply.status(200).send(result);
    }
  );

  fastify.post(
    '/bar/tabs/:id/void',
    {
      preHandler: ownerOnly,
      schema: {
        description: 'Void an open tab with a reason (owner)',
        tags: ['Bar'],
        params: IdParams,
        body: VoidTabRequestSchema,
        response: { 200: TabSchema, 400: err, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const tab = await service.voidTab(request.params.id, request.user!.id);
      await fastify.iamService.logAuditEvent({
        action: 'BAR_TAB_VOIDED',
        actor: request.user!.id,
        target: tab.id,
        details: { tabNumber: tab.tabNumber, reason: request.body.reason },
      });
      request.log.warn({ tabId: tab.id, reason: request.body.reason, actorId: request.user!.id }, 'Bar tab voided');
      return reply.status(200).send(tab);
    }
  );

  // --------------------------------------------------------------- tickets

  fastify.get(
    '/bar/tickets',
    {
      preHandler: [requirePermission('bar:kitchen')],
      schema: {
        description: 'Kitchen and bar tickets, oldest first',
        tags: ['Bar'],
        querystring: TicketListQuerySchema,
        response: { 200: TicketListSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => reply.status(200).send(await service.listTickets(request.query))
  );

  fastify.patch(
    '/bar/tickets/:id/status',
    {
      preHandler: [requirePermission('bar:kitchen')],
      schema: {
        description: 'Move a ticket NEW, PREPARING, READY, SERVED (or CANCELLED)',
        tags: ['Bar'],
        params: IdParams,
        body: UpdateTicketStatusRequestSchema,
        response: { 200: TicketSchema, 400: err, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) =>
      reply.status(200).send(await service.updateTicketStatus(request.params.id, request.body.status))
  );

  // -------------------------------------------------------------- earnings

  fastify.get(
    '/bar/earnings',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'Bar takings for a club day. Bar staff see today only; the owner sees any day.',
        tags: ['Bar'],
        querystring: BarEarningsQuerySchema,
        response: { 200: BarEarningsSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const { date } = request.query;
      if (date && date !== service.clubToday() && !isOwner(request)) {
        throw new DomainError('FORBIDDEN', 403, "Bar staff can only view today's earnings");
      }
      return reply.status(200).send(await service.earnings(date));
    }
  );

  // ---------------------------------------------------------- table bookings

  fastify.get(
    '/bar/bookings',
    {
      preHandler: [requirePermission('bar:read')],
      schema: {
        description: 'Table bookings for one club day (or up to 14 days from it), for the floor timeline',
        tags: ['Bar'],
        querystring: TableBookingQuerySchema,
        response: { 200: TableBookingListSchema, 400: err, ...authErrors },
      },
    },
    async (request, reply) => reply.status(200).send(await bookings.list(request.query))
  );

  fastify.post(
    '/bar/bookings',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Reserve a bar table. Refused with 409 when the table is already booked in that window.',
        tags: ['Bar'],
        body: CreateTableBookingRequestSchema,
        response: { 201: TableBookingSchema, 400: err, 404: err, 409: err, 422: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const booking = await bookings.create(request.body, request.user!.id);
      await fastify.iamService.logAuditEvent({ action: 'BAR_BOOKING_CREATED', actor: request.user!.id, target: booking.id, details: { tableId: booking.tableId, startsAt: booking.startsAt } });
      request.log.info({ bookingId: booking.id, actorId: request.user!.id }, 'Bar table booked');
      return reply.status(201).send(booking);
    }
  );

  fastify.put(
    '/bar/bookings/:id',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Move or resize a booking, edit its details, or change its status. Overlaps are refused with 409.',
        tags: ['Bar'],
        params: IdParams,
        body: UpdateTableBookingRequestSchema,
        response: { 200: TableBookingSchema, 400: err, 404: err, 409: err, 422: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const booking = await bookings.update(request.params.id, request.body);
      await fastify.iamService.logAuditEvent({ action: 'BAR_BOOKING_UPDATED', actor: request.user!.id, target: booking.id, details: { fields: Object.keys(request.body) } });
      return reply.status(200).send(booking);
    }
  );

  fastify.delete(
    '/bar/bookings/:id',
    {
      preHandler: [requirePermission('bar:manage')],
      schema: {
        description: 'Cancel a booking (kept as history)',
        tags: ['Bar'],
        params: IdParams,
        response: { 200: TableBookingSchema, 404: err, 409: err, ...authErrors },
      },
    },
    async (request, reply) => {
      const booking = await bookings.cancel(request.params.id);
      await fastify.iamService.logAuditEvent({ action: 'BAR_BOOKING_CANCELLED', actor: request.user!.id, target: booking.id, details: { tableId: booking.tableId } });
      return reply.status(200).send(booking);
    }
  );
};
