import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { bookings, courtTypes, courts, socialWindows, systemSettings } from '@packages/db';
import {
  AvailabilityQuerySchema,
  AvailabilitySchema,
  CourtListSchema,
  CourtSchema,
  CourtTypeListSchema,
  CreateCourtRequestSchema,
  CreateCourtTypeRequestSchema,
  CourtTypeSchema,
  UpdateCourtTypeRequestSchema,
  DeleteCourtResponseSchema,
  UpdateCourtRequestSchema,
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
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION, pgCode } from '../../lib/db-errors.js';

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
          courtTypeId: courts.courtTypeId,
          sortOrder: courts.sortOrder,
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
  // Court management (owner): sports, create, edit, remove
  // ---------------------------------------------------------------------------
  const manageCourts = [requirePermission('courts:update')];
  const courtErrors = { 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema } as const;

  /** The court as the list endpoint shapes it: a court is bookable only while its sport is too. */
  async function loadCourt(id: string) {
    const [row] = await fastify.db
      .select({
        id: courts.id,
        name: courts.name,
        type: courtTypes.code,
        typeName: courtTypes.name,
        baseRatePaise: courtTypes.baseRatePaise,
        socialCapacity: courtTypes.socialCapacity,
        courtActive: courts.isActive,
        typeActive: courtTypes.isActive,
        courtTypeId: courts.courtTypeId,
        sortOrder: courts.sortOrder,
        imageUrl: courts.imageUrl,
      })
      .from(courts)
      .innerJoin(courtTypes, eq(courtTypes.id, courts.courtTypeId))
      .where(eq(courts.id, id))
      .limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Court not found.');
    const { courtActive, typeActive, ...court } = row;
    return { ...court, isActive: courtActive && typeActive };
  }

  async function assertSportUsable(courtTypeId: string) {
    const [type] = await fastify.db.select({ isActive: courtTypes.isActive }).from(courtTypes).where(eq(courtTypes.id, courtTypeId)).limit(1);
    if (!type) throw new DomainError('NOT_FOUND', 404, 'Sport not found.');
    if (!type.isActive) throw new DomainError('VALIDATION_ERROR', 422, 'That sport is switched off. Choose another.');
  }

  /** A court cannot be taken out of service while guests still hold bookings on it. */
  async function assertNoUpcomingBookings(courtId: string) {
    const [upcoming] = await fastify.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.courtId, courtId), ne(bookings.status, 'CANCELLED'), gt(bookings.endsAt, new Date())))
      .limit(1);
    if (upcoming) {
      throw new DomainError('COURT_HAS_BOOKINGS', 409, 'This court has upcoming bookings. Cancel or move them first.');
    }
  }

  const toCourtTypeDto = (r: typeof courtTypes.$inferSelect) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    baseRatePaise: r.baseRatePaise,
    socialFeePaise: r.socialFeePaise,
    trialFeePaise: r.trialFeePaise,
    socialCapacity: r.socialCapacity,
    isActive: r.isActive,
  });

  const duplicateName = (name: string) => new DomainError('CONFLICT', 409, `A court named "${name}" already exists.`);

  fastify.get(
    '/court-types',
    {
      preHandler: manageCourts,
      schema: {
        description: 'Sports a court can be assigned to (owner)',
        tags: ['Courts'],
        response: { 200: CourtTypeListSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (_request, reply) => {
      const rows = await fastify.db.select().from(courtTypes).orderBy(asc(courtTypes.name));
      return reply.status(200).send(rows.map(toCourtTypeDto));
    }
  );

  fastify.post(
    '/court-types',
    {
      preHandler: manageCourts,
      schema: {
        description: 'Add a sport (owner)',
        tags: ['Courts'],
        body: CreateCourtTypeRequestSchema,
        response: { 201: CourtTypeSchema, ...courtErrors, 409: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      let row: typeof courtTypes.$inferSelect;
      try {
        [row] = await fastify.db
          .insert(courtTypes)
          .values({
            code: body.code,
            name: body.name,
            baseRatePaise: body.baseRatePaise,
            socialFeePaise: body.socialFeePaise ?? 0,
            trialFeePaise: body.trialFeePaise ?? 0,
            ...(body.socialCapacity !== undefined && { socialCapacity: body.socialCapacity }),
            ...(body.isActive !== undefined && { isActive: body.isActive }),
          })
          .returning();
      } catch (error) {
        if (pgCode(error) === UNIQUE_VIOLATION) throw new DomainError('CONFLICT', 409, `A sport with code "${body.code}" already exists.`);
        throw error;
      }
      await fastify.iamService.logAuditEvent({ action: 'COURT_TYPE_CREATED', actor: request.user!.id, target: row.id, details: { code: body.code } });
      return reply.status(201).send(toCourtTypeDto(row));
    }
  );

  fastify.put(
    '/court-types/:id',
    {
      preHandler: manageCourts,
      schema: {
        description: 'Rename a sport, change its prices, or switch it on or off (owner)',
        tags: ['Courts'],
        params: z.object({ id: UuidSchema }),
        body: UpdateCourtTypeRequestSchema,
        response: { 200: CourtTypeSchema, ...courtErrors, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const [current] = await fastify.db.select().from(courtTypes).where(eq(courtTypes.id, id)).limit(1);
      if (!current) throw new DomainError('NOT_FOUND', 404, 'Sport not found.');
      if (body.isActive === false && current.isActive) {
        const [inUse] = await fastify.db
          .select({ id: courts.id })
          .from(courts)
          .where(and(eq(courts.courtTypeId, id), eq(courts.isActive, true)))
          .limit(1);
        if (inUse) throw new DomainError('SPORT_IN_USE', 409, 'Active courts still use this sport. Move or switch them off first.');
      }
      const patch = {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.baseRatePaise !== undefined && { baseRatePaise: body.baseRatePaise }),
        ...(body.socialFeePaise !== undefined && { socialFeePaise: body.socialFeePaise }),
        ...(body.trialFeePaise !== undefined && { trialFeePaise: body.trialFeePaise }),
        ...(body.socialCapacity !== undefined && { socialCapacity: body.socialCapacity }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      };
      const [row] =
        Object.keys(patch).length === 0
          ? [current]
          : await fastify.db.update(courtTypes).set(patch).where(eq(courtTypes.id, id)).returning();
      await fastify.iamService.logAuditEvent({ action: 'COURT_TYPE_UPDATED', actor: request.user!.id, target: id, details: { fields: Object.keys(body) } });
      return reply.status(200).send(toCourtTypeDto(row));
    }
  );

  fastify.post(
    '/courts',
    {
      preHandler: manageCourts,
      schema: {
        description: 'Add a court (owner)',
        tags: ['Courts'],
        body: CreateCourtRequestSchema,
        response: { 201: CourtSchema, ...courtErrors, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, 422: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      await assertSportUsable(body.courtTypeId);
      let id: string;
      try {
        const [row] = await fastify.db
          .insert(courts)
          .values({ name: body.name, courtTypeId: body.courtTypeId, sortOrder: body.sortOrder ?? 0, isActive: body.isActive ?? true, imageUrl: body.imageUrl ?? null })
          .returning({ id: courts.id });
        id = row.id;
      } catch (error) {
        if (pgCode(error) === UNIQUE_VIOLATION) throw duplicateName(body.name);
        throw error;
      }
      await fastify.iamService.logAuditEvent({ action: 'COURT_CREATED', actor: request.user!.id, target: id, details: { name: body.name } });
      request.log.info({ courtId: id, actorId: request.user!.id }, 'Court created');
      return reply.status(201).send(await loadCourt(id));
    }
  );

  fastify.put(
    '/courts/:id',
    {
      preHandler: manageCourts,
      schema: {
        description: 'Rename a court, change its sport or order, or switch it on or off (owner)',
        tags: ['Courts'],
        params: z.object({ id: UuidSchema }),
        body: UpdateCourtRequestSchema,
        response: { 200: CourtSchema, ...courtErrors, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, 422: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const current = await loadCourt(id);
      if (body.courtTypeId !== undefined && body.courtTypeId !== current.courtTypeId) await assertSportUsable(body.courtTypeId);
      if (body.isActive === false || (body.courtTypeId !== undefined && body.courtTypeId !== current.courtTypeId)) {
        await assertNoUpcomingBookings(id);
      }
      const patch = {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.courtTypeId !== undefined && { courtTypeId: body.courtTypeId }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
      };
      if (Object.keys(patch).length > 0) {
        try {
          await fastify.db.update(courts).set(patch).where(eq(courts.id, id));
        } catch (error) {
          if (pgCode(error) === UNIQUE_VIOLATION) throw duplicateName(body.name ?? current.name);
          throw error;
        }
      }
      await fastify.iamService.logAuditEvent({ action: 'COURT_UPDATED', actor: request.user!.id, target: id, details: { fields: Object.keys(body) } });
      request.log.info({ courtId: id, actorId: request.user!.id }, 'Court updated');
      return reply.status(200).send(await loadCourt(id));
    }
  );

  fastify.delete(
    '/courts/:id',
    {
      preHandler: manageCourts,
      schema: {
        description: 'Remove a court (owner). A court with booking history is switched off instead of deleted.',
        tags: ['Courts'],
        params: z.object({ id: UuidSchema }),
        response: { 200: DeleteCourtResponseSchema, ...courtErrors, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const current = await loadCourt(id);
      await assertNoUpcomingBookings(id);
      let result = { deleted: true, deactivated: false };
      try {
        await fastify.db.delete(courts).where(eq(courts.id, id));
      } catch (error) {
        if (pgCode(error) !== FOREIGN_KEY_VIOLATION) throw error;
        await fastify.db.update(courts).set({ isActive: false }).where(eq(courts.id, id));
        result = { deleted: false, deactivated: true };
      }
      await fastify.iamService.logAuditEvent({ action: 'COURT_REMOVED', actor: request.user!.id, target: id, details: { name: current.name, ...result } });
      request.log.warn({ courtId: id, actorId: request.user!.id, ...result }, 'Court removed');
      return reply.status(200).send(result);
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
        logoUrl: request.body.logoUrl !== undefined ? request.body.logoUrl : (current.success ? current.data.logoUrl : undefined) ?? null,
      };
      await fastify.db
        .insert(systemSettings)
        .values({ key: 'club.profile', value: merged, description: 'Public club details shown on the website (name, tagline, phone, address)' })
        .onConflictDoUpdate({ target: [systemSettings.tenantId, systemSettings.key], set: { value: merged, updatedAt: new Date() } });
      request.log.info({ actorId: request.user!.id, fields: Object.keys(request.body) }, 'Club profile updated');
      await fastify.iamService.logAuditEvent({ action: 'CLUB_PROFILE_UPDATED', actor: request.user!.id, details: { fields: Object.keys(request.body) } });
      return reply.status(200).send(merged);
    }
  );
};
