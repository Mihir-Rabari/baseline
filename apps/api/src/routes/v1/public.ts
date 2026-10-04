import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, asc, count, eq } from 'drizzle-orm';
import { bookings, courts, courtTypes, plans, socialWindows, systemSettings } from '@packages/db';
import {
  AvailabilityQuerySchema, AvailabilitySchema, HttpErrorResponseSchema,
  PublicClubSchema, PlanListSchema, CreateEnquiryRequestSchema, CreateEnquiryResponseSchema,
  CreateTrialBookingRequestSchema,
  CreatePublicBookingRequestSchema,
  CreatePublicBookingResponseSchema,
  CreateBookingHoldRequestSchema, PaymentIntentSchema, PaymentWebhookRequestSchema, PaymentWebhookResponseSchema,
  type PaymentIntent,
  promiseFeePaise, CreateTrialBookingResponseSchema,
  SharedReportParamSchema, SharedReportQuerySchema, SharedReportResponseSchema,
} from '@packages/validation';
import { DomainError } from '../../lib/domain-error.js';
import { verifyPaymentWebhook } from '../../lib/payment-signature.js';
import type { PaymentIntentRow } from '../../services/booking.service.js';
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
      phone: z.string().optional(), address: z.string().optional(), logoUrl: z.string().nullable().optional(),
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
      phone: contact.phone ?? '', address: contact.address ?? '', logoUrl: contact.logoUrl ?? null,
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
    const { owed: _owed, alerts: _alerts, ...summary } = await reports.dashboard(
      // A custom-period link is fixed to its window; the viewer cannot widen it with ?range.
      share.from && share.to ? { from: share.from, to: share.to } : { range: request.query.range ?? share.defaultRange }
    );
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

  // A guest picks a slot, chooses how to pay and confirms. UPI and card collect the full price;
  // cash collects a 20% promise fee now and the rest at the venue. There is no external gateway:
  // the chosen method is recorded as paid, exactly like a desk payment.
  fastify.post('/public/bookings', {
    config: postLimit,
    schema: { tags: ['Public'], description: 'Guest booking with checkout (UPI/card full, cash = 20% promise fee).', body: CreatePublicBookingRequestSchema, response: { 201: CreatePublicBookingResponseSchema, ...errors } },
  }, async (request, reply) => {
    const { courtId, startsAt, name, phone, email, method } = request.body;
    const booking = await bookingService.create({
      courtId, startsAt: new Date(startsAt), guest: { name, phone, email }, channel: 'ONLINE', kind: 'STANDARD',
      payNow: { method }, promiseFee: method === 'CASH',
    });
    const paidPaise = booking.paymentStatus === 'PAID' ? booking.pricePaise : booking.paymentStatus === 'PARTIAL' ? promiseFeePaise(booking.pricePaise) : 0;
    const duePaise = booking.pricePaise - paidPaise;
    request.log.info({ bookingId: booking.id, courtId, method }, 'Guest booking created');
    return reply.status(201).send({
      booking, paidPaise, duePaise,
      message: duePaise > 0 ? 'Booked. Pay the rest at the club.' : 'Booked and paid. See you on court.',
    });
  });

  const toIntent = async (row: PaymentIntentRow): Promise<PaymentIntent> => ({
    id: row.id, status: row.status, method: row.method, amountPaise: row.amountPaise, totalPaise: row.totalPaise,
    duePaise: row.totalPaise - row.amountPaise, expiresAt: row.expiresAt.toISOString(),
    booking: row.bookingId ? await bookingService.getBooking(row.bookingId) : null,
  });

  // Gateway flow: hold the slot, let the gateway collect `amountPaise`, then confirm via webhook.
  // The amount is derived from the server-side price; the client never sends one.
  fastify.post('/public/bookings/holds', {
    config: postLimit,
    schema: { tags: ['Public'], description: 'Hold a slot for a guest checkout. Unpaid holds expire and release the slot.', body: CreateBookingHoldRequestSchema, response: { 201: PaymentIntentSchema, ...errors } },
  }, async (request, reply) => {
    const { courtId, startsAt, name, phone, email, method } = request.body;
    const intent = await bookingService.createHold({
      courtId, startsAt: new Date(startsAt), guest: { name, phone, email }, method, ttlMinutes: fastify.env.PAYMENT_HOLD_MINUTES,
    });
    request.log.info({ intentId: intent.id, courtId, method }, 'Guest booking hold created');
    return reply.status(201).send(await toIntent(intent));
  });

  // Polled by the checkout page. The id is an unguessable UUID and the response carries no more than
  // the guest already submitted.
  fastify.get('/public/payment-intents/:id', {
    config: getLimit,
    schema: { tags: ['Public'], params: z.object({ id: z.string().uuid() }), response: { 200: PaymentIntentSchema, 400: HttpErrorResponseSchema, 404: HttpErrorResponseSchema, 429: HttpErrorResponseSchema } },
  }, async (request, reply) => {
    let row = await bookingService.getIntent(request.params.id);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Payment not found.');
    if (row.status === 'PENDING' && row.expiresAt.getTime() <= Date.now()) {
      await bookingService.expireHolds();
      row = (await bookingService.getIntent(request.params.id)) ?? row;
    }
    return reply.header('cache-control', 'no-store').send(await toIntent(row));
  });

  fastify.post('/public/payments/webhook', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['Public'], description: 'Signed gateway webhook (HMAC-SHA256 in x-signature). Idempotent per reference.',
      body: PaymentWebhookRequestSchema,
      response: { 200: PaymentWebhookResponseSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 404: HttpErrorResponseSchema, 409: HttpErrorResponseSchema, 429: HttpErrorResponseSchema, 503: HttpErrorResponseSchema },
    },
  }, async (request, reply) => {
    const secret = fastify.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) throw new DomainError('WEBHOOK_DISABLED', 503, 'Payment webhooks are not configured.');
    if (!verifyPaymentWebhook(secret, request.body, request.headers['x-signature'])) {
      request.log.warn({ intentId: request.body.intentId }, 'Payment webhook rejected: bad signature');
      throw new DomainError('INVALID_SIGNATURE', 401, 'Invalid webhook signature.');
    }
    const { intentId, event, amountPaise, reference } = request.body;
    const result = event === 'payment.succeeded'
      ? await bookingService.confirmHold(intentId, { amountPaise, reference })
      : await bookingService.failHold(intentId);
    request.log.info({ intentId, event, duplicate: result.duplicate }, 'Payment webhook applied');
    return reply.send({ intentId, status: result.intent.status, duplicate: result.duplicate });
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
