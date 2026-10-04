import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { resetEnvCache } from '@packages/config/env';
import { bookings, courtOccupancies, getDb, paymentIntents, payments } from '@packages/db';
import { PaymentIntentSchema, promiseFeePaise, type PaymentWebhookRequest } from '@packages/validation';
import { buildApp } from './app.js';
import { signPaymentWebhook } from './lib/payment-signature.js';
import { BookingService } from './services/booking.service.js';
import { addDays, clubDateOf, clubWallTimeToInstant } from './services/time.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { FixtureTracker, createCourt, createCourtType } from './test-support/court-fixtures.js';
import { MembersFixtures } from './test-support/members-fixtures.js';

const SECRET = 'test-webhook-secret-0123456789';

describe('Guest checkout holds and webhooks (#67)', () => {
  const db = getDb();
  const tracker = new FixtureTracker();
  const actors = new MembersFixtures();
  const prefix = `hold-${randomUUID()}`;
  let app: FastifyInstance;
  let available = false;
  let courtId: string;
  let deskCookie = '';
  let ip = 0;

  const startsAt = (hour: number) => clubWallTimeToInstant(addDays(clubDateOf(new Date(), 'Asia/Kolkata'), 1), hour * 60, 'Asia/Kolkata').toISOString();
  const guest = (hour: number, method: string, extra: object = {}) => ({
    courtId, startsAt: startsAt(hour), name: prefix, phone: MembersFixtures.phone(), email: `${randomUUID()}@example.com`, method, ...extra,
  });
  const hold = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/public/bookings/holds', payload, remoteAddress: `10.115.0.${++ip}` });
  const direct = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/public/bookings', payload, remoteAddress: `10.115.1.${++ip}` });
  const webhook = (body: PaymentWebhookRequest, signature: string | null = signPaymentWebhook(SECRET, body)) =>
    app.inject({ method: 'POST', url: '/api/v1/public/payments/webhook', payload: body, headers: signature ? { 'x-signature': signature } : {}, remoteAddress: `10.115.2.${++ip}` });
  const paid = (intentId: string, amountPaise: number, reference = `gw_${randomUUID()}`, event: PaymentWebhookRequest['event'] = 'payment.succeeded'): PaymentWebhookRequest =>
    ({ intentId, event, amountPaise, reference });
  const createHold = async (hour: number, method: string) => {
    const response = await hold(guest(hour, method));
    expect(response.statusCode, response.body).toBe(201);
    return PaymentIntentSchema.parse(response.json());
  };
  const paymentsFor = (bookingId: string) => db.select().from(payments).where(eq(payments.sourceId, bookingId));
  const expireNow = (intentId: string) => db.update(paymentIntents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(paymentIntents.id, intentId));

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    if (!available) return;
    process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
    resetEnvCache();
    app = buildApp();
    await app.ready();
    MembersFixtures.spreadClientIps(app);
    const type = await createCourtType(db);
    tracker.courtTypeIds.push(type.id);
    const court = await createCourt(db, type.id);
    courtId = court.id;
    tracker.courtIds.push(court.id);
    deskCookie = (await actors.actor(app, 'FRONT_DESK')).cookie;
  });

  afterAll(async () => {
    if (available) {
      const rows = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.courtId, courtId));
      if (rows.length) await db.delete(payments).where(inArray(payments.sourceId, rows.map((b) => b.id)));
      await db.delete(paymentIntents).where(eq(paymentIntents.courtId, courtId));
      await db.delete(courtOccupancies).where(eq(courtOccupancies.courtId, courtId));
      await tracker.cleanup(db);
      await actors.cleanup();
      delete process.env.PAYMENT_WEBHOOK_SECRET;
      resetEnvCache();
    }
    if (app) await app.close();
  });

  it('a hold computes the amount on the server: full for UPI and card, 20% for cash', async (ctx) => {
    if (!available) return ctx.skip();
    const upi = await createHold(12, 'UPI');
    expect(upi).toMatchObject({ status: 'PENDING', booking: null, method: 'UPI', duePaise: 0 });
    expect(upi.amountPaise).toBe(upi.totalPaise);
    const cash = await createHold(13, 'CASH');
    expect(cash.amountPaise).toBe(promiseFeePaise(cash.totalPaise));
    expect(cash.duePaise).toBe(cash.totalPaise - cash.amountPaise);
    // The hold is not a booking and records no money yet.
    expect(await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.courtId, courtId))).toHaveLength(0);
    // A client-supplied amount or price is ignored (strict contract: extra keys never reach the service).
    const tampered = PaymentIntentSchema.parse((await hold(guest(14, 'UPI', { amountPaise: 1, pricePaise: 1, status: 'SUCCEEDED' }))).json());
    expect(tampered.amountPaise).toBeGreaterThan(1);
    expect(tampered.status).toBe('PENDING');
  });

  it('400 for a bad method, phone or missing fields', async (ctx) => {
    if (!available) return ctx.skip();
    for (const payload of [guest(15, 'BITCOIN'), guest(15, 'UPI', { phone: '1' }), guest(15, 'UPI', { courtId: 'x' }), { courtId }]) {
      expect((await hold(payload)).statusCode).toBe(400);
    }
  });

  it('a held slot cannot be taken by another guest, directly or by another hold', async (ctx) => {
    if (!available) return ctx.skip();
    await createHold(16, 'UPI');
    const second = await hold(guest(16, 'CARD'));
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SLOT_TAKEN');
    expect((await direct(guest(16, 'UPI'))).statusCode).toBe(409);
    const race = await Promise.all([1, 2, 3].map(() => hold(guest(17, 'UPI'))));
    expect(race.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(race.filter((r) => r.statusCode === 409)).toHaveLength(2);
  });

  it('a signed payment.succeeded confirms the booking, records one payment and is idempotent', async (ctx) => {
    if (!available) return ctx.skip();
    const intent = await createHold(18, 'UPI');
    const body = paid(intent.id, intent.amountPaise);
    const first = await webhook(body);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ intentId: intent.id, status: 'SUCCEEDED', duplicate: false });
    const status = PaymentIntentSchema.parse((await app.inject({ method: 'GET', url: `/api/v1/public/payment-intents/${intent.id}` })).json());
    expect(status.status).toBe('SUCCEEDED');
    expect(status.booking).toMatchObject({ kind: 'STANDARD', channel: 'ONLINE', status: 'CONFIRMED', paymentStatus: 'PAID', paidPaise: intent.totalPaise, pricePaise: intent.totalPaise });
    const rows = await paymentsFor(status.booking!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'UPI', amountPaise: intent.amountPaise, reference: body.reference, kind: 'PAYMENT' });

    // The gateway retries: same reference, same result, no second payment.
    const replay = await webhook(body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicate).toBe(true);
    expect(await paymentsFor(status.booking!.id)).toHaveLength(1);
    // A different reference against a settled intent is refused.
    const other = await webhook(paid(intent.id, intent.amountPaise));
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe('ALREADY_PAID');
    expect(await paymentsFor(status.booking!.id)).toHaveLength(1);
  });

  it('a cash hold confirms as PARTIAL with the promise fee; the desk then sees paid and due', async (ctx) => {
    if (!available) return ctx.skip();
    const intent = await createHold(19, 'CASH');
    expect((await webhook(paid(intent.id, intent.amountPaise))).statusCode).toBe(200);
    const status = PaymentIntentSchema.parse((await app.inject({ method: 'GET', url: `/api/v1/public/payment-intents/${intent.id}` })).json());
    expect(status.booking).toMatchObject({ paymentStatus: 'PARTIAL', paidPaise: intent.amountPaise });
    const list = await app.inject({ method: 'GET', url: `/api/v1/bookings?date=${status.booking!.bookingDate}&limit=100`, headers: { cookie: deskCookie } });
    expect(list.statusCode, list.body).toBe(200);
    const row = list.json().data.find((b: { id: string }) => b.id === status.booking!.id);
    expect(row).toMatchObject({ paymentStatus: 'PARTIAL', paidPaise: intent.amountPaise, pricePaise: intent.totalPaise });
  });

  it('rejects a missing, malformed or forged signature with 401 and changes nothing', async (ctx) => {
    if (!available) return ctx.skip();
    const intent = await createHold(20, 'UPI');
    const body = paid(intent.id, intent.amountPaise);
    for (const signature of [null, 'nope', 'a'.repeat(64), signPaymentWebhook('some-other-secret-0123456789', body)]) {
      const response = await webhook(body, signature);
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('INVALID_SIGNATURE');
    }
    // A signature for a smaller amount cannot be reused for a different one.
    const cheap = signPaymentWebhook(SECRET, paid(intent.id, 1, body.reference));
    expect((await webhook(body, cheap)).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/payment-intents/${intent.id}` })).json().status).toBe('PENDING');
  });

  it('a validly signed but wrong amount is refused with 409 and books nothing', async (ctx) => {
    if (!available) return ctx.skip();
    const intent = await createHold(21, 'UPI');
    for (const amount of [1, intent.amountPaise - 1, intent.amountPaise + 1]) {
      const response = await webhook(paid(intent.id, amount));
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().code).toBe('AMOUNT_MISMATCH');
    }
    const row = await new BookingService(db, { timezone: 'Asia/Kolkata' }).getIntent(intent.id);
    expect(row).toMatchObject({ status: 'PENDING', bookingId: null });
    // A cash hold cannot be settled with the full price either: only the promise fee is expected.
    const cash = await createHold(7, 'CASH');
    expect((await webhook(paid(cash.id, cash.totalPaise))).statusCode).toBe(409);
  });

  it('refuses malformed bodies with 400 and unknown intents with 404', async (ctx) => {
    if (!available) return ctx.skip();
    const raw = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/public/payments/webhook', payload, headers: { 'x-signature': 'a'.repeat(64) }, remoteAddress: `10.115.3.${++ip}` });
    expect((await raw({ intentId: 'bad', event: 'payment.succeeded', amountPaise: 1, reference: 'x' })).statusCode).toBe(400);
    expect((await raw({ intentId: randomUUID(), event: 'refund', amountPaise: 1, reference: 'x' })).statusCode).toBe(400);
    expect((await webhook(paid(randomUUID(), 100))).statusCode).toBe(404);
  });

  it('payment.failed releases the slot at once so someone else can book it', async (ctx) => {
    if (!available) return ctx.skip();
    const intent = await createHold(8, 'CARD');
    const failed = await webhook(paid(intent.id, 0, `gw_${randomUUID()}`, 'payment.failed'));
    expect(failed.statusCode, failed.body).toBe(200);
    expect(failed.json()).toMatchObject({ status: 'FAILED', duplicate: false });
    expect((await webhook(paid(intent.id, 0, `gw_${randomUUID()}`, 'payment.failed'))).json().duplicate).toBe(true);
    // A late success for a failed intent never creates a booking.
    const late = await webhook(paid(intent.id, intent.amountPaise));
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('HOLD_EXPIRED');
    expect((await direct(guest(8, 'UPI'))).statusCode).toBe(201);
  });

  it('an expired hold is released by the job; a late payment is refused and books nothing', async (ctx) => {
    if (!available) return ctx.skip();
    const intent = await createHold(9, 'UPI');
    await expireNow(intent.id);
    // Even before the job runs, a payment arriving after the deadline is refused.
    const lateReference = `gw_${randomUUID()}`;
    const late = await webhook(paid(intent.id, intent.amountPaise, lateReference));
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('HOLD_EXPIRED');

    const released = await new BookingService(db, { timezone: 'Asia/Kolkata' }).expireHolds();
    expect(released).toBeGreaterThanOrEqual(1);
    const status = PaymentIntentSchema.parse((await app.inject({ method: 'GET', url: `/api/v1/public/payment-intents/${intent.id}` })).json());
    expect(status).toMatchObject({ status: 'EXPIRED', booking: null });
    // Slot is free again, and a payment for the dead intent still cannot book it.
    expect((await direct(guest(9, 'UPI'))).statusCode).toBe(201);
    const afterRelease = await webhook(paid(intent.id, intent.amountPaise, lateReference));
    expect(afterRelease.statusCode).toBe(409);
    expect(await db.select({ id: payments.id }).from(payments).where(eq(payments.reference, lateReference))).toHaveLength(0);
  });

  it('creating a hold lazily releases stale holds on the same slot', async (ctx) => {
    if (!available) return ctx.skip();
    const stale = await createHold(10, 'UPI');
    await expireNow(stale.id);
    const fresh = await hold(guest(10, 'CARD'));
    expect(fresh.statusCode, fresh.body).toBe(201);
    expect((await new BookingService(db, { timezone: 'Asia/Kolkata' }).getIntent(stale.id))?.status).toBe('EXPIRED');
  });

  it('the intent status endpoint 400s on a bad id and 404s on an unknown one', async (ctx) => {
    if (!available) return ctx.skip();
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/payment-intents/not-a-uuid' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/payment-intents/${randomUUID()}` })).statusCode).toBe(404);
  });
});
