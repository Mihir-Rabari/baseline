import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { courtTypes, courts, socialWindows, systemSettings } from '@packages/db';
import {
  AvailabilityQuerySchema,
  AvailabilitySchema,
  CourtListSchema,
  HttpErrorResponseSchema,
  ClubProfileSchema,
  SocialWindowListSchema,
  SocialWindowSchema,
  UpdateClubProfileRequestSchema,
  UpdateSocialWindowRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { requirePermission } from '@packages/iam';
import { AvailabilityService } from '../../services/availability.service.js';
import { requireCourtCaller, resolveCourtCaller } from '../../lib/court-caller.js';
import { DomainError } from '../../lib/domain-error.js';

/**
 * `social_windows.weekday` is stored as an ISO weekday (1 = Monday ... 7 = Sunday) because that is what
 * the slot generator compares against. The API speaks 0..6 with Sunday = 0, matching /public/club.
 */
const toApiWeekday = (stored: number) => stored % 7;
const toStoredWeekday = (api: number) => (api === 0 ? 7 : api);
const hhmm = (time: string) => time.slice(0, 5);

function toSocialWindow(row: typeof socialWindows.$inferSelect) {
  return {
    id: row.id,
    weekday: toApiWeekday(row.weekday),
    startsTime: hhmm(row.startsTime),
    endsTime: hhmm(row.endsTime),
    isActive: row.isActive,
  };
}

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
  // ---------------------------------------------------------------------------
  // GET /api/v1/social-windows - weekly social-play windows (any logged-in, active user)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/social-windows',
    {
      preHandler: [requirePermission('profile:read:self', (req) => ({ resourceOwnerId: req.user?.id }))],
      schema: {
        description: 'Weekly social-play windows (weekday 0 = Sunday ... 6 = Saturday)',
        tags: ['Courts'],
        response: { 200: SocialWindowListSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (_request, reply) => {
      const rows = await fastify.db
        .select()
        .from(socialWindows)
        .orderBy(asc(socialWindows.weekday), asc(socialWindows.startsTime), asc(socialWindows.id));
      return reply.status(200).send(rows.map(toSocialWindow));
    }
  );

  // ---------------------------------------------------------------------------
  // PUT /api/v1/social-windows/:id - owner edits a window
  // ---------------------------------------------------------------------------
  fastify.put(
    '/social-windows/:id',
    {
      preHandler: [requirePermission('courts:update')],
      schema: {
        description: 'Change the weekday, times or active flag of a social-play window (owner only)',
        tags: ['Courts'],
        params: z.object({ id: UuidSchema }),
        body: UpdateSocialWindowRequestSchema,
        response: {
          200: SocialWindowSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
          422: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const [current] = await fastify.db.select().from(socialWindows).where(eq(socialWindows.id, id)).limit(1);
      if (!current) throw new DomainError('NOT_FOUND', 404, 'Social window not found.');

      // The schema only compares times when both are sent; a one-sided edit is checked against the stored value.
      const startsTime = body.startsTime ?? hhmm(current.startsTime);
      const endsTime = body.endsTime ?? hhmm(current.endsTime);
      if (endsTime <= startsTime) {
        throw new DomainError('VALIDATION_ERROR', 422, 'endsTime must be after startsTime', [
          { field: 'endsTime', message: 'endsTime must be after startsTime', code: 'INVALID_RANGE' },
        ]);
      }

      const [row] = await fastify.db
        .update(socialWindows)
        .set({
          ...(body.weekday !== undefined && { weekday: toStoredWeekday(body.weekday) }),
          ...(body.startsTime !== undefined && { startsTime: body.startsTime }),
          ...(body.endsTime !== undefined && { endsTime: body.endsTime }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
        })
        .where(eq(socialWindows.id, id))
        .returning();
      request.log.info({ windowId: id, actorId: request.user!.id }, 'Social window updated');
      return reply.status(200).send(toSocialWindow(row));
    }
  );
  // ---------------------------------------------------------------------------
  // PUT /api/v1/club/profile - owner edits the details shown on the public website
  // ---------------------------------------------------------------------------
  fastify.put(
    '/club/profile',
    {
      preHandler: [requirePermission('courts:update')],
      schema: {
        description: "Change the club's public name, tagline, phone or address (owner only). Only the fields sent change.",
        tags: ['Courts'],
        body: UpdateClubProfileRequestSchema,
        response: { 200: ClubProfileSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const [existing] = await fastify.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'club.profile')).limit(1);
      const current = ClubProfileSchema.partial().safeParse(existing?.value);
      const merged = {
        name: request.body.name ?? (current.success ? current.data.name : undefined) ?? fastify.env.APP_NAME,
        tagline: request.body.tagline ?? (current.success ? current.data.tagline : undefined) ?? '',
        phone: request.body.phone ?? (current.success ? current.data.phone : undefined) ?? '',
        address: request.body.address ?? (current.success ? current.data.address : undefined) ?? '',
      };
      await fastify.db
        .insert(systemSettings)
        .values({ key: 'club.profile', value: merged, description: 'Public club details shown on the website (name, tagline, phone, address)' })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: merged, updatedAt: new Date() } });
      request.log.info({ actorId: request.user!.id, fields: Object.keys(request.body) }, 'Club profile updated');
      await fastify.iamService.logAuditEvent({ action: 'CLUB_PROFILE_UPDATED', actor: request.user!.id, details: { fields: Object.keys(request.body) } });
      return reply.status(200).send(merged);
    }
  );
};
