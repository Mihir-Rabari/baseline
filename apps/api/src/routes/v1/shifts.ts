import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import {
  CreateShiftRequestSchema,
  CurrentShiftSchema,
  HttpErrorResponseSchema,
  ShiftListQuerySchema,
  ShiftListSchema,
  ShiftSchema,
  SuccessMessageSchema,
  UuidSchema,
} from '@packages/validation';
import { can } from '../../lib/authz.js';
import { ShiftService } from '../../services/shift.service.js';

const IdParam = z.object({ id: UuidSchema });
const authErrors = { 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema };
const errors = { 400: HttpErrorResponseSchema, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, ...authErrors };

/** Staff shifts (API_CONTRACT.md section 8). */
export const shiftRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new ShiftService(fastify.db, fastify.env.CLUB_TIMEZONE);
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
};
