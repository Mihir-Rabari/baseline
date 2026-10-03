import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { asc, eq } from 'drizzle-orm';
import { courtTypes, courts } from '@packages/db';
import {
  AvailabilityQuerySchema,
  AvailabilitySchema,
  CourtListSchema,
  HttpErrorResponseSchema,
} from '@packages/validation';
import { requirePermission } from '@packages/iam';
import { AvailabilityService } from '../../services/availability.service.js';
import { requireCourtCaller, resolveCourtCaller } from '../../lib/court-caller.js';

export const courtRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const availabilityService = new AvailabilityService(fastify.db, fastify.env.CLUB_TIMEZONE);

  // ---------------------------------------------------------------------------
  // GET /api/v1/courts - list courts (any logged-in, active user)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/courts',
    {
      // `profile:read:self` is granted to every active identity, so this is "any logged-in user"
      // while still denying suspended and disabled accounts (rule 10).
      preHandler: [requirePermission('profile:read:self', (req) => ({ resourceOwnerId: req.user?.id }))],
      schema: {
        description: 'List courts with their sport and list price',
        tags: ['Courts'],
        response: {
          200: CourtListSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const rows = await fastify.db
        .select({
          id: courts.id,
          name: courts.name,
          type: courtTypes.code,
          typeName: courtTypes.name,
          baseRatePaise: courtTypes.baseRatePaise,
          socialCapacity: courtTypes.socialCapacity,
          courtActive: courts.isActive,
          typeActive: courtTypes.isActive,
        })
        .from(courts)
        .innerJoin(courtTypes, eq(courtTypes.id, courts.courtTypeId))
        .orderBy(asc(courts.sortOrder), asc(courts.name));

      return reply
        .status(200)
        .send(rows.map(({ courtActive, typeActive, ...court }) => ({ ...court, isActive: courtActive && typeActive })));
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/courts/availability - the booking grid (MEM, FD, OWN)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/courts/availability',
    {
      preHandler: [requireCourtCaller],
      schema: {
        description:
          'Half-hourly availability grid for a club date. Members are priced as themselves; front desk and owner may pass memberId.',
        tags: ['Courts'],
        querystring: AvailabilityQuerySchema,
        response: {
          200: AvailabilitySchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
          422: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const caller = await resolveCourtCaller(request);
      const { date, courtTypeId, memberId } = request.query;

      const availability = await availabilityService.getAvailability({
        date,
        courtTypeId,
        memberId,
        viewer: caller === 'STAFF' ? { kind: 'STAFF', memberId } : { kind: 'MEMBER', userId: request.user!.id },
      });

      return reply.status(200).send(availability);
    }
  );
};
