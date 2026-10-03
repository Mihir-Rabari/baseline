import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuthentication, requirePermission } from '@packages/iam';
import {
  CheckinRequestSchema,
  CheckinResponseSchema,
  CreateMemberRequestSchema,
  CreateMemberResponseSchema,
  HttpErrorResponseSchema,
  MemberListQuerySchema,
  MemberLookupQuerySchema,
  MemberLookupResponseSchema,
  MemberPageSchema,
  MemberSchema,
  MemberTimelinePageSchema,
  MemberTimelineQuerySchema,
  PlanListSchema,
  PlanSchema,
  RenewMembershipRequestSchema,
  RenewMembershipResponseSchema,
  UpdatePlanRequestSchema,
  UpsertMyMemberRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { MembershipService } from '../../services/membership.service.js';

function pageMeta(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

const IdParams = z.object({ id: UuidSchema });

const errors = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  403: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema,
} as const;

/**
 * Plans, members, memberships and the caller's own member profile.
 *
 * BAR_STAFF holds `members:read` so the POS can use `/members/lookup`, but must not browse full
 * profiles, histories or run check-ins (API_CONTRACT 4.2: FD, OWN only). Those routes therefore also
 * require `members:update`, which BAR_STAFF does not have.
 */
export const memberRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const service = new MembershipService(fastify.db);
  const deskRead = [requirePermission('members:read'), requirePermission('members:update')];

  // ------------------------------------------------------------------ plans

  fastify.get(
    '/plans',
    {
      preHandler: [requireAuthentication()],
      schema: {
        description: 'List membership plans with their entitlements',
        tags: ['Plans'],
        response: { 200: PlanListSchema, 401: HttpErrorResponseSchema },
      },
    },
    async (_request, reply) => reply.status(200).send(await service.listPlans())
  );

  fastify.put(
    '/plans/:id',
    {
      preHandler: [requirePermission('plans:update')],
      schema: {
        description: 'Edit a plan (owner)',
        tags: ['Plans'],
        params: IdParams,
        body: UpdatePlanRequestSchema,
        response: { 200: PlanSchema, ...errors },
      },
    },
    async (request, reply) => {
      const plan = await service.updatePlan(request.params.id, request.body);
      request.log.info({ planId: plan.id, actorId: request.user!.id }, 'Plan updated');
      return reply.status(200).send(plan);
    }
  );

  // ---------------------------------------------------------------- members

  fastify.get(
    '/members',
    {
      preHandler: deskRead,
      schema: {
        description: 'Search and filter members',
        tags: ['Members'],
        querystring: MemberListQuerySchema,
        response: { 200: MemberPageSchema, 400: errors[400], 401: errors[401], 403: errors[403] },
      },
    },
    async (request, reply) => {
      const { rows, total } = await service.list(request.query);
      return reply.status(200).send({ data: rows, meta: pageMeta(request.query.page, request.query.limit, total) });
    }
  );

  fastify.get(
    '/members/lookup',
    {
      preHandler: [requirePermission('members:read')],
      schema: {
        description: 'Type-ahead member search for the desk and bar POS',
        tags: ['Members'],
        querystring: MemberLookupQuerySchema,
        response: { 200: MemberLookupResponseSchema, 400: errors[400], 401: errors[401], 403: errors[403] },
      },
    },
    async (request, reply) => reply.status(200).send(await service.lookup(request.query.q, request.query.limit))
  );

  fastify.post(
    '/members',
    {
      preHandler: [requirePermission('members:create'), requirePermission('memberships:create')],
      schema: {
        description: 'Register a member and take the first payment in one step',
        tags: ['Members'],
        body: CreateMemberRequestSchema,
        response: {
          201: CreateMemberResponseSchema,
          400: errors[400],
          401: errors[401],
          403: errors[403],
          404: errors[404],
          409: HttpErrorResponseSchema,
          422: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.register(request.body, request.user!.id);
      request.log.info(
        { memberId: result.member.id, memberCode: result.member.memberCode, actorId: request.user!.id },
        'Member registered'
      );
      return reply.status(201).send(result);
    }
  );

  fastify.get(
    '/members/:id',
    {
      preHandler: deskRead,
      schema: {
        description: 'Member profile with plan, expiry and entitlements',
        tags: ['Members'],
        params: IdParams,
        response: { 200: MemberSchema, ...errors },
      },
    },
    async (request, reply) => reply.status(200).send(await service.getMember(request.params.id))
  );

  fastify.get(
    '/members/:id/timeline',
    {
      preHandler: deskRead,
      schema: {
        description: 'Check-ins, bookings, orders, tabs, invoices and membership events, newest first',
        tags: ['Members'],
        params: IdParams,
        querystring: MemberTimelineQuerySchema,
        response: { 200: MemberTimelinePageSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { page, limit } = request.query;
      const { rows, total } = await service.timeline(request.params.id, page, limit);
      return reply.status(200).send({ data: rows, meta: pageMeta(page, limit, total) });
    }
  );

  fastify.post(
    '/members/:id/checkin',
    {
      preHandler: [requirePermission('members:read'), requirePermission('members:update')],
      schema: {
        description: 'Record a check-in; the response carries the expiry state so the desk can warn',
        tags: ['Members'],
        params: IdParams,
        body: CheckinRequestSchema.nullish(),
        response: { 201: CheckinResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.checkin(request.params.id, request.user!.id, request.body?.bookingId);
      return reply.status(201).send(result);
    }
  );

  fastify.post(
    '/members/:id/membership/renew',
    {
      preHandler: [requirePermission('memberships:update')],
      schema: {
        description: 'Renew a membership for another 30 days and take payment',
        tags: ['Members'],
        params: IdParams,
        body: RenewMembershipRequestSchema,
        response: {
          200: RenewMembershipResponseSchema,
          ...errors,
          409: HttpErrorResponseSchema,
          422: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.renew(request.params.id, request.body.paymentMethod, request.user!.id);
      request.log.info({ memberId: request.params.id, actorId: request.user!.id }, 'Membership renewed');
      return reply.status(200).send(result);
    }
  );

  // ----------------------------------------------------------------- /me/member

  const selfGuard = (permission: 'profile:read:self' | 'profile:update:self') =>
    requirePermission(permission, (req) => ({ resourceOwnerId: req.user?.id }));

  fastify.get(
    '/me/member',
    {
      preHandler: [selfGuard('profile:read:self')],
      schema: {
        description: "The caller's own member profile, or 404 NOT_A_MEMBER if none exists yet",
        tags: ['Members'],
        response: { 200: MemberSchema, 401: errors[401], 403: errors[403], 404: errors[404] },
      },
    },
    async (request, reply) => reply.status(200).send(await service.getMemberByUserId(request.user!.id))
  );

  fastify.put(
    '/me/member',
    {
      preHandler: [selfGuard('profile:update:self')],
      schema: {
        description: "Create or update the caller's own member profile (no membership is granted)",
        tags: ['Members'],
        body: UpsertMyMemberRequestSchema,
        response: {
          200: MemberSchema,
          400: errors[400],
          401: errors[401],
          403: errors[403],
          422: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => reply.status(200).send(await service.upsertOwnProfile(request.user!.id, request.body))
  );
};
