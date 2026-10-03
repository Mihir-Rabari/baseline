import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, asc, count, eq } from 'drizzle-orm';
import { bookings, courts, courtTypes, plans, socialWindows, systemSettings } from '@packages/db';
import {
  AvailabilityQuerySchema, AvailabilitySchema, HttpErrorResponseSchema,
  PublicClubSchema, PlanListSchema, CreateEnquiryRequestSchema, CreateEnquiryResponseSchema,
  CreateTrialBookingRequestSchema, CreateTrialBookingResponseSchema,
  SharedReportParamSchema, SharedReportQuerySchema, SharedReportResponseSchema,
} from '@packages/validation';
import { AvailabilityService } from '../../services/availability.service.js';
import { BookingService } from '../../services/booking.service.js';
import { CrmService } from '../../services/crm.service.js';
import { getClubHours } from '../../services/club-settings.js';
import { ReportService } from '../../services/report.service.js';
import { ReportShareService } from '../../services/report-share.service.js';

const PublicAvailabilityQuerySchema = AvailabilityQuerySchema.omit({ memberId: true });

export const publicRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const availabilityService = new AvailabilityService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const crm = new CrmService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const bookingService = new BookingService(fastify.db, { timezone: fastify.env.CLUB_TIMEZONE });
  const reports = new ReportService(fastify.db, fastify.env.CLUB_TIMEZONE);
  const reportShares = new ReportShareService(fastify.db, fastify.env.WEB_URL);
  const getLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
  const postLimit = { rateLimit: { max: 5, timeWindow: '1 minute' } };
  const errors = {
    400: HttpErrorResponseSchema, 404: HttpErrorResponseSchema,
    409: HttpErrorResponseSchema, 422: HttpErrorResponseSchema, 429: HttpErrorResponseSchema,
  };

  fastify.get('/public/club', {
    config: getLimit,
    schema: { tags: ['Public'], response: { 200: PublicClubSchema, 429: HttpErrorResponseSchema } },
  }, async (_request, reply) => {
    const [profile] = await fastify.db.select({ value: systemSettings.value }).from(systemSettings)
      .where(eq(systemSettings.key, 'club.profile')).limit(1);
    const metadata = z.object({
      name: z.string().optional(), tagline: z.string().optional(),
      phone: z.string().optional(), address: z.string().optional(),
    }).safeParse(profile?.value);
    const contact = metadata.success ? metadata.data : {};
    const types = await fastify.db.select({
      id: courtTypes.id, code: courtTypes.code, name: courtTypes.name,
      baseRatePaise: courtTypes.baseRatePaise, trialFeePaise: courtTypes.trialFeePaise,
      courtCount: count(courts.id),
    }).from(courtTypes).leftJoin(courts, and(eq(courts.courtTypeId, courtTypes.id), eq(courts.isActive, true)))
      .where(eq(courtTypes.isActive, true)).groupBy(courtTypes.id).orderBy(asc(courtTypes.code));
    const [social] = await fastify.db.select({
      weekday: socialWindows.weekday, startsTime: socialWindows.startsTime, endsTime: socialWindows.endsTime,
    }).from(socialWindows).where(eq(socialWindows.isActive, true))
      .orderBy(asc(socialWindows.weekday), asc(socialWindows.startsTime), asc(socialWindows.id)).limit(1);
    return reply.send({
      name: contact.name ?? fastify.env.APP_NAME, tagline: contact.tagline ?? '',
      phone: contact.phone ?? '', address: contact.address ?? '',
      hours: await getClubHours(fastify.db), timezone: fastify.env.CLUB_TIMEZONE,
      courtTypes: types,
      socialPlay: social ? {
        weekday: social.weekday % 7, startsTime: social.startsTime.slice(0, 5), endsTime: social.endsTime.slice(0, 5),
      } : { weekday: 5, startsTime: '18:00', endsTime: '22:00' },
    });
  });

  fastify.get('/public/plans', {
    config: getLimit,
    schema: { tags: ['Public'], response: { 200: PlanListSchema, 429: HttpErrorResponseSchema } },
  }, async (_request, reply) => reply.send(await fastify.db.select().from(plans)
    .where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder), asc(plans.code))));

  // /public/products is registered by shopRoutes, using the public-only catalogue projection.
  // Owner-created, read-only dashboard link. Summary only: no owed amounts, no alerts, no names.
  fastify.get('/public/reports/shared/:token', {
    config: getLimit,
    schema: {
      description: 'Shared dashboard summary for a valid, unexpired, unrevoked token',
      tags: ['Public'],
      params: SharedReportParamSchema,
      querystring: SharedReportQuerySchema,
      response: { 200: SharedReportResponseSchema, 404: HttpErrorResponseSchema, 429: HttpErrorResponseSchema },
    },
  }, async (request, reply) => {
    const share = await reportShares.resolve(request.params.token);
    const { owed: _owed, alerts: _alerts, ...summary } = await reports.dashboard({ range: request.query.range ?? share.defaultRange });
    return reply.header('cache-control', 'no-store').send({ ...summary, expiresAt: share.expiresAt });
  });

  fastify.post('/public/enquiries', {
    config: postLimit,
    schema: { tags: ['Public'], body: CreateEnquiryRequestSchema, response: { 201: CreateEnquiryResponseSchema, ...errors } },
  }, async (request, reply) => {
    const lead = await crm.createLead({ ...request.body, source: 'WEBSITE_ENQUIRY' });
    return reply.status(201).send({ id: lead.id, message: "Thanks, we'll be in touch within one working day." });
  });

  fastify.post('/public/trial-bookings', {
    config: postLimit,
    schema: { tags: ['Public'], body: CreateTrialBookingRequestSchema, response: { 201: CreateTrialBookingResponseSchema, ...errors } },
  }, async (request, reply) => {
    const { courtId, startsAt, name, phone, email } = request.body;
    let leadId!: string;
    const booking = await bookingService.create({
      courtId, startsAt: new Date(startsAt), guest: { name, phone, email }, kind: 'TRIAL',
      inTransaction: async (tx, bookingId) => {
        const lead = await crm.createLead({ name, phone, email, source: 'WEBSITE_TRIAL' }, null, tx);
        leadId = lead.id;
        await tx.update(bookings).set({ leadId }).where(eq(bookings.id, bookingId));
      },
    });
    return reply.status(201).send({ booking, leadId, message: 'Trial booked. Pay at the club on arrival.' });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/public/availability - no login, walk-in price, no booking details
  // ---------------------------------------------------------------------------
  fastify.get(
    '/public/availability',
    {
      // Stricter than the global limit: 30 GETs/minute/IP (API_CONTRACT.md section 3).
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        description: 'Public availability grid at walk-in prices (looks 7 days ahead, the trial booking horizon)',
        tags: ['Public'],
        querystring: PublicAvailabilityQuerySchema,
        response: {
          200: AvailabilitySchema,
          400: HttpErrorResponseSchema,
          422: HttpErrorResponseSchema,
          429: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { date, courtTypeId } = request.query;
      const availability = await availabilityService.getAvailability({
        date,
        courtTypeId,
        viewer: { kind: 'PUBLIC' },
      });
      return reply.status(200).send(availability);
    }
  );
};
