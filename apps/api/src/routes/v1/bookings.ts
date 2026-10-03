import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PolicyEngine, requirePermission, type IamService } from '@packages/iam';
import {
  BookingListQuerySchema,
  BookingPageSchema,
  BookingRaceRequestSchema,
  BookingRaceResponseSchema,
  BookingSchema,
  CancelBookingRequestSchema,
  CancelBookingResponseSchema,
  CreateBookingRequestSchema,
  HttpErrorResponseSchema,
  JoinSocialRequestSchema,
  JoinSocialResponseSchema,
  MyBookingsQuerySchema,
  PayBookingRequestSchema,
  PayBookingResponseSchema,
  UuidSchema,
} from '@packages/validation';
import { DomainError } from '../../lib/domain-error.js';
import { BookingService } from '../../services/booking.service.js';

const IdParamSchema = z.object({ id: UuidSchema });

const errors = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  403: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema,
  409: HttpErrorResponseSchema,
  422: HttpErrorResponseSchema,
};

function unauthorized(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(401).send({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Authentication required to access this resource',
    code: 'UNAUTHORIZED',
    requestId: request.id,
    timestamp: new Date().toISOString(),
  });
}

function forbidden(request: FastifyRequest, reply: FastifyReply, action: string) {
  return reply.status(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: `You do not have permission to perform '${action}'`,
    code: 'FORBIDDEN',
    requestId: request.id,
    timestamp: new Date().toISOString(),
  });
}

/** Evaluates one action for the caller; `ownerId` feeds the `:self` ownership check (Rule 10). */
async function can(request: FastifyRequest, action: string, ownerId?: string | null): Promise<boolean> {
  if (!request.user) return false;
  if (!request.effectiveStatements) {
    const iam = (request.server as unknown as { iamService: IamService }).iamService;
    request.effectiveStatements = await iam.getUserStatements(request.user.id);
  }
  return PolicyEngine.evaluate({
    identity: request.user,
    action,
    statements: request.effectiveStatements,
    // A `:self` action only matches when resourceOwnerId equals the caller; an owner-less
    // resource (a guest booking) must never match, so pass an impossible id instead of undefined.
    context: ownerId === undefined ? undefined : { resourceOwnerId: ownerId ?? '' },
  }).allowed;
}

/** Entry guard: staff holding `staffAction`, or a member holding `selfAction` for their own id. */
function requireStaffOrSelf(staffAction: string, selfAction: string): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) return unauthorized(request, reply);
    if (await can(request, staffAction)) return;
    if (await can(request, selfAction, request.user.id)) return;
    return forbidden(request, reply, staffAction);
  };
}

export const bookingRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const bookingService = new BookingService(fastify.db, {
    timezone: fastify.env.CLUB_TIMEZONE,
    audit: (event) => fastify.iamService.logAuditEvent(event),
  });

  /**
   * Works out who a create/join is for. Staff must name exactly one of memberId/guest. A member
   * is always booking for themselves: another member's id is 403 (checked with that member's
   * userId as `resourceOwnerId`), and guests are not allowed.
   */
  async function resolveSubject(
    request: FastifyRequest,
    reply: FastifyReply,
    body: { memberId?: string; guest?: { name: string; phone: string; email?: string } },
    staffAction: string,
    selfAction: string
  ) {
    const staff = await can(request, staffAction);
    if (staff) {
      if (!body.memberId === !body.guest) {
        throw new DomainError('VALIDATION_ERROR', 400, 'Provide exactly one of memberId or guest.', [
          { field: 'memberId', message: 'Provide exactly one of memberId or guest', code: 'INVALID' },
        ]);
      }
      return { staff, memberId: body.memberId, guest: body.guest };
    }

    if (body.guest) {
      forbidden(request, reply, selfAction);
      return null;
    }
    const own = await bookingService.findMemberByUserId(request.user!.id);
    if (!own) throw new DomainError('NOT_A_MEMBER', 404, 'This account has no member profile.');
    const targetId = body.memberId ?? own.id;
    const target = targetId === own.id ? own : await bookingService.findMember(targetId);
    if (!target || !(await can(request, selfAction, target.userId))) {
      forbidden(request, reply, selfAction);
      return null;
    }
    return { staff, memberId: target.id, guest: undefined };
  }

  // ---------------------------------------------------------------------------
  // POST /bookings
  // ---------------------------------------------------------------------------
  fastify.post(
    '/bookings',
    {
      preHandler: [requireStaffOrSelf('bookings:create', 'bookings:create:self')],
      schema: {
        description:
          'Create a one-hour court booking. Members book for themselves; front desk and owner book for a member or a guest. The database guarantees no double booking.',
        tags: ['Bookings'],
        body: CreateBookingRequestSchema,
        response: { 201: BookingSchema, ...errors },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const subject = await resolveSubject(request, reply, body, 'bookings:create', 'bookings:create:self');
      if (!subject) return;

      if (!subject.staff && body.payNow && body.payNow.method !== 'UPI') {
        return forbidden(request, reply, 'bookings:create');
      }

      const booking = await bookingService.create({
        courtId: body.courtId,
        startsAt: new Date(body.startsAt),
        memberId: subject.memberId,
        guest: subject.guest,
        channel: subject.staff ? (body.channel ?? 'DESK') : 'ONLINE',
        payNow: body.payNow,
        actorUserId: request.user!.id,
      });
      request.log.info({ bookingId: booking.id, courtId: booking.court.id }, 'Booking created');
      return reply.status(201).send(booking);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /bookings/social/join  (registered before /bookings/:id/* routes)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/bookings/social/join',
    {
      preHandler: [requireStaffOrSelf('bookings:create', 'bookings:create:self')],
      schema: {
        description: 'Join a Friday social-play session. Capacity is enforced with a row lock.',
        tags: ['Bookings'],
        body: JoinSocialRequestSchema,
        response: { 201: JoinSocialResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const subject = await resolveSubject(request, reply, body, 'bookings:create', 'bookings:create:self');
      if (!subject) return;

      const booking = await bookingService.joinSocial({
        courtId: body.courtId,
        startsAt: new Date(body.startsAt),
        memberId: subject.memberId,
        guest: subject.guest,
        channel: subject.staff ? 'DESK' : 'ONLINE',
        actorUserId: request.user!.id,
      });
      request.log.info({ bookingId: booking.id, socialSessionId: booking.socialSessionId }, 'Social session joined');
      return reply.status(201).send(booking);
    }
  );

  // ---------------------------------------------------------------------------
  // GET /bookings  (staff)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/bookings',
    {
      preHandler: [requirePermission('bookings:read')],
      schema: {
        description: 'List bookings (front desk, owner).',
        tags: ['Bookings'],
        querystring: BookingListQuerySchema,
        response: { 200: BookingPageSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => reply.send(await bookingService.list(request.query))
  );

  // ---------------------------------------------------------------------------
  // GET /me/bookings  (member, own only)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/me/bookings',
    {
      preHandler: [requirePermission('bookings:read:self', (req) => ({ resourceOwnerId: req.user?.id }))],
      schema: {
        description: "The signed-in member's own bookings.",
        tags: ['Bookings'],
        querystring: MyBookingsQuerySchema,
        response: { 200: BookingPageSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const { scope, ...rest } = request.query;
      const own = await bookingService.findMemberByUserId(request.user!.id);
      if (!own) {
        return reply.send({
          data: [],
          meta: { page: rest.page, limit: rest.limit, totalItems: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
        });
      }
      return reply.send(await bookingService.list(rest, { memberId: own.id, scope }));
    }
  );

  /** Loads the booking owner and authorises the caller as staff or as that owner. */
  async function authorizeBooking(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    staffAction: string,
    selfAction: string
  ): Promise<boolean> {
    const owner = await bookingService.getOwner(id);
    if (!owner.exists) {
      throw new DomainError('NOT_FOUND', 404, 'Booking not found.');
    }
    if ((await can(request, staffAction)) || (await can(request, selfAction, owner.ownerUserId))) return true;
    forbidden(request, reply, staffAction);
    return false;
  }

  // ---------------------------------------------------------------------------
  // GET /bookings/:id
  // ---------------------------------------------------------------------------
  fastify.get(
    '/bookings/:id',
    {
      preHandler: [requireStaffOrSelf('bookings:read', 'bookings:read:self')],
      schema: {
        description: 'One booking. Members may only read their own.',
        tags: ['Bookings'],
        params: IdParamSchema,
        response: { 200: BookingSchema, ...errors },
      },
    },
    async (request, reply) => {
      if (!(await authorizeBooking(request, reply, request.params.id, 'bookings:read', 'bookings:read:self'))) return;
      return reply.send((await bookingService.getBooking(request.params.id))!);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /bookings/:id/cancel
  // ---------------------------------------------------------------------------
  fastify.post(
    '/bookings/:id/cancel',
    {
      preHandler: [requireStaffOrSelf('bookings:cancel', 'bookings:cancel:self')],
      schema: {
        description:
          'Cancel a booking. At least the cutoff (default 2h) before the start: court and quota freed and any payment refunded. Later: court freed, no refund, quota kept. Staff with bookings:override may waive the cutoff with a reason.',
        tags: ['Bookings'],
        params: IdParamSchema,
        body: CancelBookingRequestSchema,
        response: { 200: CancelBookingResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await authorizeBooking(request, reply, id, 'bookings:cancel', 'bookings:cancel:self'))) return;
      if (request.body.override && !(await can(request, 'bookings:override'))) {
        return forbidden(request, reply, 'bookings:override');
      }
      const result = await bookingService.cancel({
        bookingId: id,
        actorUserId: request.user!.id,
        reason: request.body.reason,
        override: request.body.override,
      });
      request.log.info({ bookingId: id, late: result.late, override: Boolean(request.body.override) }, 'Booking cancelled');
      return reply.send(result);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /bookings/:id/pay
  // ---------------------------------------------------------------------------
  fastify.post(
    '/bookings/:id/pay',
    {
      preHandler: [requireStaffOrSelf('payments:create', 'bookings:create:self')],
      schema: {
        description: 'Record payment for a booking (staff: any method; member: own booking, UPI only).',
        tags: ['Bookings'],
        params: IdParamSchema,
        body: PayBookingRequestSchema,
        response: { 200: PayBookingResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await authorizeBooking(request, reply, id, 'payments:create', 'bookings:create:self'))) return;
      if (!(await can(request, 'payments:create')) && request.body.method !== 'UPI') {
        return forbidden(request, reply, 'payments:create');
      }
      const result = await bookingService.pay({
        bookingId: id,
        method: request.body.method,
        reference: request.body.reference,
        actorUserId: request.user!.id,
      });
      request.log.info({ bookingId: id, method: request.body.method }, 'Booking paid');
      return reply.send(result);
    }
  );

  // No dedicated catalog entries exist for these staff transitions, so they use bookings:cancel,
  // which front desk and owner hold and members never do.
  fastify.post(
    '/bookings/:id/no-show',
    {
      preHandler: [requirePermission('bookings:cancel')],
      schema: {
        description: 'Mark a booking as a no-show (staff). It keeps counting toward the daily quota.',
        tags: ['Bookings'],
        params: IdParamSchema,
        response: { 200: BookingSchema, ...errors },
      },
    },
    async (request, reply) => reply.send(await bookingService.markNoShow(request.params.id))
  );

  fastify.post(
    '/bookings/:id/complete',
    {
      preHandler: [requirePermission('bookings:cancel')],
      schema: {
        description: 'Mark a booking as completed (staff).',
        tags: ['Bookings'],
        params: IdParamSchema,
        response: { 200: BookingSchema, ...errors },
      },
    },
    async (request, reply) => reply.send(await bookingService.complete(request.params.id))
  );

  // ---------------------------------------------------------------------------
  // POST /demo/booking-race  (owner/admin; 404 in production)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/demo/booking-race',
    {
      preHandler: [
        async (request, reply) => {
          if (fastify.env.NODE_ENV === 'production') {
            return reply.status(404).send({
              statusCode: 404,
              error: 'Not Found',
              message: 'Route not found',
              code: 'NOT_FOUND',
              requestId: request.id,
              timestamp: new Date().toISOString(),
            });
          }
        },
        requirePermission('admin:access'),
      ],
      schema: {
        description: 'Demo tool: fire concurrent bookings at one slot and show that exactly one wins. Disabled in production.',
        tags: ['Demo'],
        body: BookingRaceRequestSchema,
        response: { 200: BookingRaceResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await bookingService.runRace({
        courtId: request.body.courtId,
        startsAt: new Date(request.body.startsAt),
        attempts: request.body.attempts,
        actorUserId: request.user!.id,
      });
      request.log.info({ ...result }, 'Booking race demo finished');
      return reply.send(result);
    }
  );
};
