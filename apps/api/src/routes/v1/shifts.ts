import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  CreateShiftRequestSchema,
  ColleagueListSchema,
  CreateShiftSwapRequestSchema,
  CurrentShiftSchema,
  HttpErrorResponseSchema,
  ShiftListQuerySchema,
  ShiftListSchema,
  ShiftSchema,
  ShiftSwapDecisionRequestSchema,
  ShiftSwapListQuerySchema,
  ShiftSwapListSchema,
  ShiftSwapResponseRequestSchema,
  ShiftSwapSchema,
  SuccessMessageSchema,
  UuidSchema,
} from '@packages/validation';
import { can } from '../../lib/authz.js';
import { ShiftService } from '../../services/shift.service.js';
import { ShiftSwapService } from '../../services/shift-swap.service.js';

const IdParam = z.object({ id: UuidSchema });
const authErrors = { 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema };
const errors = { 400: HttpErrorResponseSchema, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, ...authErrors };
const swapErrors = { ...errors, 422: HttpErrorResponseSchema };

/** Staff shifts (API_CONTRACT.md section 8). */
export const shiftRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new ShiftService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const swaps = new ShiftSwapService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const clockGuard = requirePermission('shifts:clock:self', (req) => ({ resourceOwnerId: req.user?.id }));

  fastify.get(
    '/shifts',
    {
      preHandler: [requirePermission('shifts:read')],
      schema: {
        description: 'Shift roster. Owner and front desk see everyone; other staff see only their own shifts.',
        tags: ['Shifts'],
        querystring: ShiftListQuerySchema,
        response: { 200: ShiftListSchema, 400: errors[400], ...authErrors },
      },
    },
    async (request, reply) => {
      const roster = await can(request, 'shifts:read:all');
      const employeeId = await service.employeeIdForUser(request.user!.id);
      return reply.send(await service.list(request.query, { roster, employeeId }));
    }
  );

  fastify.post(
    '/shifts',
    {
      preHandler: [requirePermission('shifts:manage')],
      schema: {
        description: 'Schedule a shift (owner). An employee cannot have two overlapping shifts.',
        tags: ['Shifts'],
        body: CreateShiftRequestSchema,
        response: { 201: ShiftSchema, ...errors },
      },
    },
    async (request, reply) => {
      const shift = await service.create(request.body);
      request.log.info({ shiftId: shift.id, employeeId: shift.employee.id, actorId: request.user!.id }, 'Shift scheduled');
      return reply.status(201).send(shift);
    }
  );

  fastify.delete(
    '/shifts/:id',
    {
      preHandler: [requirePermission('shifts:manage')],
      schema: {
        description: 'Delete a shift nobody has clocked into yet (owner).',
        tags: ['Shifts'],
        params: IdParam,
        response: { 200: SuccessMessageSchema, ...errors },
      },
    },
    async (request, reply) => {
      await service.delete(request.params.id);
      request.log.info({ shiftId: request.params.id, actorId: request.user!.id }, 'Shift deleted');
      return reply.send({ success: true, message: 'Shift deleted' });
    }
  );

  fastify.post(
    '/shifts/:id/clock-in',
    {
      preHandler: [clockGuard],
      schema: {
        description: 'Clock in to your own shift (from 30 minutes before it starts until it ends).',
        tags: ['Shifts'],
        params: IdParam,
        response: { 200: ShiftSchema, ...errors },
      },
    },
    async (request, reply) => {
      const employeeId = await service.employeeIdForUser(request.user!.id);
      const shift = await service.clockIn(request.params.id, employeeId);
      request.log.info({ shiftId: shift.id, actorId: request.user!.id }, 'Clocked in');
      return reply.send(shift);
    }
  );

  fastify.post(
    '/shifts/:id/clock-out',
    {
      preHandler: [clockGuard],
      schema: {
        description: 'Clock out of your own shift.',
        tags: ['Shifts'],
        params: IdParam,
        response: { 200: ShiftSchema, ...errors },
      },
    },
    async (request, reply) => {
      const employeeId = await service.employeeIdForUser(request.user!.id);
      const shift = await service.clockOut(request.params.id, employeeId);
      request.log.info({ shiftId: shift.id, actorId: request.user!.id }, 'Clocked out');
      return reply.send(shift);
    }
  );

  fastify.get(
    '/me/shift/current',
    {
      preHandler: [clockGuard],
      schema: {
        description: 'The shift you are working, or the one you can clock into now, or null.',
        tags: ['Shifts'],
        response: { 200: CurrentShiftSchema, ...authErrors },
      },
    },
    async (request, reply) => reply.send(await service.current(await service.employeeIdForUser(request.user!.id)))
  );

  // ---------------------------------------------------------------------------
  // Shift swaps. Staff propose and answer (own shifts only); the owner approves or overrides.
  // ---------------------------------------------------------------------------
  fastify.get(
    '/me/colleagues',
    {
      preHandler: [clockGuard],
      schema: { description: 'Active staff you can offer a shift to (everyone but you).', tags: ['Shifts'], response: { 200: ColleagueListSchema, ...authErrors } },
    },
    async (request, reply) => reply.send(await swaps.colleagues(await service.employeeIdForUser(request.user!.id)))
  );

  fastify.get(
    '/me/shifts/upcoming',
    {
      preHandler: [clockGuard],
      schema: { description: 'Your shifts that can still be offered in a swap: not started, not clocked into, not already in an open swap.', tags: ['Shifts'], response: { 200: ShiftListSchema, ...authErrors } },
    },
    async (request, reply) => reply.send(await swaps.upcomingShifts(await service.employeeIdForUser(request.user!.id)))
  );

  fastify.get(
    '/me/shift-swaps',
    {
      preHandler: [clockGuard],
      schema: { description: 'Swaps you proposed or were asked to take, newest first.', tags: ['Shifts'], response: { 200: ShiftSwapListSchema, ...authErrors } },
    },
    async (request, reply) => reply.send(await swaps.listMine(await service.employeeIdForUser(request.user!.id)))
  );

  fastify.post(
    '/me/shift-swaps',
    {
      preHandler: [clockGuard],
      schema: {
        description: 'Offer one of your upcoming shifts to a colleague, optionally for one of theirs. The colleague is notified.',
        tags: ['Shifts'],
        body: CreateShiftSwapRequestSchema,
        response: { 201: ShiftSwapSchema, ...swapErrors },
      },
    },
    async (request, reply) => {
      const swap = await swaps.propose(await service.employeeIdForUser(request.user!.id), request.body);
      request.log.info({ swapId: swap.id, actorId: request.user!.id }, 'Shift swap proposed');
      return reply.status(201).send(swap);
    }
  );

  fastify.post(
    '/me/shift-swaps/:id/respond',
    {
      preHandler: [clockGuard],
      schema: {
        description: 'The colleague accepts or declines. Only the person it was offered to can answer; an accepted swap then waits for the owner.',
        tags: ['Shifts'],
        params: IdParam,
        body: ShiftSwapResponseRequestSchema,
        response: { 200: ShiftSwapSchema, ...swapErrors },
      },
    },
    async (request, reply) => {
      const swap = await swaps.respond(await service.employeeIdForUser(request.user!.id), request.params.id, request.body);
      request.log.info({ swapId: swap.id, status: swap.status, actorId: request.user!.id }, 'Shift swap answered');
      return reply.send(swap);
    }
  );

  fastify.post(
    '/me/shift-swaps/:id/cancel',
    {
      preHandler: [clockGuard],
      schema: { description: 'Withdraw a swap you proposed while it is still open.', tags: ['Shifts'], params: IdParam, response: { 200: ShiftSwapSchema, ...swapErrors } },
    },
    async (request, reply) => reply.send(await swaps.cancel(await service.employeeIdForUser(request.user!.id), request.params.id))
  );

  fastify.get(
    '/shift-swaps',
    {
      preHandler: [requirePermission('shifts:manage')],
      schema: { description: 'All swap requests, newest first (owner).', tags: ['Shifts'], querystring: ShiftSwapListQuerySchema, response: { 200: ShiftSwapListSchema, 400: errors[400], ...authErrors } },
    },
    async (request, reply) => reply.send(await swaps.listAll(request.query))
  );

  fastify.post(
    '/shift-swaps/:id/decision',
    {
      preHandler: [requirePermission('shifts:manage')],
      schema: {
        description:
          'Approve a swap the colleague accepted, or reject (override) an open one. Approval moves both shifts in one transaction and is 409 if it would double-book anyone or the shifts changed. Both people are notified.',
        tags: ['Shifts'],
        params: IdParam,
        body: ShiftSwapDecisionRequestSchema,
        response: { 200: ShiftSwapSchema, ...swapErrors },
      },
    },
    async (request, reply) => {
      const swap = await swaps.decide(request.user!.id, request.params.id, request.body);
      await fastify.iamService.logAuditEvent({ action: 'SHIFT_SWAP_DECIDED', actor: request.user!.id, target: swap.id, details: { decision: swap.status } });
      request.log.info({ swapId: swap.id, status: swap.status, actorId: request.user!.id }, 'Shift swap decided');
      return reply.send(swap);
    }
  );
};
