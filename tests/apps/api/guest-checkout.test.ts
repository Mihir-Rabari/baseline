import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { bookings, getDb, payments } from '@packages/db';
import { CreatePublicBookingResponseSchema, promiseFeePaise } from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { addDays, clubDateOf, clubWallTimeToInstant } from '../../../apps/api/src/services/time.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { FixtureTracker, createCourt, createCourtType } from '../../../apps/api/src/test-support/court-fixtures.js';
import { MembersFixtures } from '../../../apps/api/src/test-support/members-fixtures.js';

describe('Guest booking checkout (#67)', () => {
  const db = getDb();
  const tracker = new FixtureTracker();
  const actors = new MembersFixtures();
  const prefix = `checkout-${randomUUID()}`;
  let app: FastifyInstance;
  let available = false;
  let courtId: string;
  let memberId: string;
  let deskCookie = '';
  let ip = 0;

  const startsAt = (hour: number) => clubWallTimeToInstant(addDays(clubDateOf(new Date(), 'Asia/Kolkata'), 1), hour * 60, 'Asia/Kolkata').toISOString();
  const book = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/public/bookings', payload, remoteAddress: `10.114.0.${++ip}` });
  const guest = (hour: number, method: string, extra: object = {}) => ({
    courtId, startsAt: startsAt(hour), name: prefix, phone: MembersFixtures.phone(), email: `${randomUUID()}@example.com`, method, ...extra,
  });
  const paidFor = (bookingId: string) => db.select().from(payments).where(eq(payments.sourceId, bookingId));

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    if (!available) return;
    app = buildApp();
    await app.ready();
    MembersFixtures.spreadClientIps(app);
    const type = await createCourtType(db);
    tracker.courtTypeIds.push(type.id);
    const court = await createCourt(db, type.id);
    courtId = court.id;
    tracker.courtIds.push(court.id);
    const desk = await actors.actor(app, 'FRONT_DESK');
    deskCookie = desk.cookie;
    memberId = (await actors.actor(app, 'MEMBER')).id;
  });

  afterAll(async () => {
    if (available) {
      const rows = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.courtId, courtId));
      if (rows.length) await db.delete(payments).where(inArray(payments.sourceId, rows.map((b) => b.id)));
      await tracker.cleanup(db);
      await actors.cleanup();
    }
    if (app) await app.close();
  });

  it('UPI or card pays the full price and confirms the booking', async (ctx) => {
    if (!available) return ctx.skip();
    for (const [hour, method] of [[12, 'UPI'], [13, 'CARD']] as const) {
      const response = await book(guest(hour, method));
      expect(response.statusCode, response.body).toBe(201);
      const body = CreatePublicBookingResponseSchema.parse(response.json());
      expect(body.booking).toMatchObject({ kind: 'STANDARD', channel: 'ONLINE', paymentStatus: 'PAID', status: 'CONFIRMED', member: null });
      expect(body.paidPaise).toBe(body.booking.pricePaise);
      expect(body.booking.paidPaise).toBe(body.booking.pricePaise);
      expect(body.duePaise).toBe(0);
      const rows = await paidFor(body.booking.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ method, kind: 'PAYMENT', source: 'COURT', amountPaise: body.booking.pricePaise });
    }
  });

  it('cash collects the 20% promise fee now; the front desk collects the rest once', async (ctx) => {
    if (!available) return ctx.skip();
    const response = await book(guest(14, 'CASH'));
    expect(response.statusCode, response.body).toBe(201);
    const body = CreatePublicBookingResponseSchema.parse(response.json());
    const fee = promiseFeePaise(body.booking.pricePaise);
    expect(body.booking.paymentStatus).toBe('PARTIAL');
    expect(body.booking.paidPaise).toBe(fee);
    expect(fee).toBe(Math.ceil(body.booking.pricePaise * 0.2));
    expect(body).toMatchObject({ paidPaise: fee, duePaise: body.booking.pricePaise - fee });
    const rows = await paidFor(body.booking.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'CASH', amountPaise: fee, reference: 'PROMISE_FEE' });

    const pay = () => app.inject({ method: 'POST', url: `/api/v1/bookings/${body.booking.id}/pay`, headers: { cookie: deskCookie }, payload: { method: 'CASH' } });
    const remainder = await pay();
    expect(remainder.statusCode, remainder.body).toBe(200);
    expect(remainder.json().payment.amountPaise).toBe(body.booking.pricePaise - fee);
    expect((await paidFor(body.booking.id)).reduce((n, r) => n + r.amountPaise, 0)).toBe(body.booking.pricePaise);
    const again = await pay();
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_PAID');
  });

  it('never trusts a client-supplied amount, status, price or member', async (ctx) => {
    if (!available) return ctx.skip();
    const response = await book(guest(15, 'UPI', { pricePaise: 1, amountPaise: 1, paymentStatus: 'PAID', memberId, status: 'COMPLETED' }));
    expect(response.statusCode, response.body).toBe(201);
    const body = CreatePublicBookingResponseSchema.parse(response.json());
    expect(body.booking.pricePaise).toBeGreaterThan(1);
    expect(body.booking).toMatchObject({ member: null, status: 'CONFIRMED' });
    expect((await paidFor(body.booking.id))[0].amountPaise).toBe(body.booking.pricePaise);
  });

  it('400 for an unknown method, bad phone or missing fields', async (ctx) => {
    if (!available) return ctx.skip();
    const bad = [guest(16, 'BITCOIN'), guest(16, 'upi'), guest(16, 'UPI', { phone: '123' }), guest(16, 'UPI', { name: ' ' }), guest(16, 'UPI', { courtId: 'bad' }), { courtId, startsAt: startsAt(16) }];
    for (const payload of bad) expect((await book(payload)).statusCode).toBe(400);
  });

  it('refuses a taken slot with 409 and records no payment; racing guests produce one winner', async (ctx) => {
    if (!available) return ctx.skip();
    expect((await book(guest(17, 'UPI'))).statusCode).toBe(201);
    const before = await db.select({ id: payments.id }).from(payments).where(eq(payments.source, 'COURT'));
    const second = await book(guest(17, 'CARD'));
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SLOT_TAKEN');
    expect(await db.select({ id: payments.id }).from(payments).where(eq(payments.source, 'COURT'))).toHaveLength(before.length);
    const race = await Promise.all([1, 2, 3].map(() => book(guest(18, 'UPI'))));
    expect(race.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(race.filter((r) => r.statusCode === 409)).toHaveLength(2);
  });

  it('cancelling in time refunds what was paid, including the promise fee', async (ctx) => {
    if (!available) return ctx.skip();
    const created = CreatePublicBookingResponseSchema.parse((await book(guest(19, 'CASH'))).json());
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/bookings/${created.booking.id}/cancel`, headers: { cookie: deskCookie }, payload: {} });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(cancel.json().refund.amountPaise).toBe(created.paidPaise);
    expect((await paidFor(created.booking.id)).reduce((n, r) => n + r.amountPaise, 0)).toBe(0);
  });
});
