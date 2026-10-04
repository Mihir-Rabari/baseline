import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { barTableBookings, barTables } from '@packages/db';
import { TableBookingListSchema, TableBookingSchema } from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { MembersFixtures, type Actor } from '../../../apps/api/src/test-support/members-fixtures.js';

const PREFIX = `TB-${randomUUID().slice(0, 6)}`;
const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000dd';
const HOUR = 3_600_000;

/** A whole-hour slot `daysAhead` days from now, so tests never collide with "now". */
const slot = (daysAhead: number, startHour: number, hours = 2) => {
  const base = new Date(Date.now() + daysAhead * 24 * HOUR);
  base.setUTCHours(startHour, 0, 0, 0);
  return { startsAt: base.toISOString(), endsAt: new Date(base.getTime() + hours * HOUR).toISOString() };
};

describe('Bar table bookings (#74)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  const db = fx.db;
  let owner: Actor;
  let bar: Actor;
  let desk: Actor;
  let member: Actor;
  let t1: string;
  let t2: string;
  let off: string;
  const bookingIds: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, actor?: Actor, payload?: object) =>
    app.inject({ method, url, headers: actor ? { cookie: actor.cookie } : {}, ...(payload ? { payload } : {}) });

  async function book(actor: Actor, body: Record<string, unknown>) {
    const res = await call('POST', '/api/v1/bar/bookings', actor, { guestName: 'Guest', partySize: 2, ...body });
    if (res.statusCode === 201) bookingIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    owner = await fx.actor(app, 'OWNER');
    bar = await fx.actor(app, 'BAR_STAFF');
    desk = await fx.actor(app, 'FRONT_DESK');
    member = await fx.actor(app, 'MEMBER');
    const rows = await db
      .insert(barTables)
      .values([
        { name: `${PREFIX}-A`, seats: 4 },
        { name: `${PREFIX}-B`, seats: 6 },
        { name: `${PREFIX}-OFF`, seats: 2, isActive: false },
      ])
      .returning({ id: barTables.id, name: barTables.name });
    t1 = rows.find((r) => r.name.endsWith('-A'))!.id;
    t2 = rows.find((r) => r.name.endsWith('-B'))!.id;
    off = rows.find((r) => r.name.endsWith('-OFF'))!.id;
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (bookingIds.length) await db.delete(barTableBookings).where(inArray(barTableBookings.id, bookingIds));
      await db.delete(barTables).where(like(barTables.name, `${PREFIX}%`));
      await fx.cleanup();
    }
    await app.close();
  });

  it('401 without a session', async () => {
    const valid = { tableId: NO_SUCH_UUID, guestName: 'x', ...slot(3, 10) };
    expect((await call('GET', '/api/v1/bar/bookings?date=2030-01-01')).statusCode).toBe(401);
    expect((await call('POST', '/api/v1/bar/bookings', undefined, valid)).statusCode).toBe(401);
    expect((await call('PUT', `/api/v1/bar/bookings/${NO_SUCH_UUID}`, undefined, { guestName: 'x' })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/v1/bar/bookings/${NO_SUCH_UUID}`)).statusCode).toBe(401);
  });

  it('403 for front desk and members: they hold no bar permissions', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const actor of [desk, member]) {
      expect((await call('GET', '/api/v1/bar/bookings?date=2030-01-01', actor)).statusCode).toBe(403);
      expect((await book(actor, { tableId: t1, ...slot(3, 10) })).statusCode).toBe(403);
      expect((await call('PUT', `/api/v1/bar/bookings/${NO_SUCH_UUID}`, actor, { guestName: 'x' })).statusCode).toBe(403);
      expect((await call('DELETE', `/api/v1/bar/bookings/${NO_SUCH_UUID}`, actor)).statusCode).toBe(403);
    }
  });

  it('400 for a malformed body or query', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const ok = slot(3, 10);
    expect((await book(bar, { tableId: t1, startsAt: ok.endsAt, endsAt: ok.startsAt })).statusCode).toBe(400); // ends before it starts
    expect((await book(bar, { tableId: t1, ...slot(3, 0, 13) })).statusCode).toBe(400); // longer than 12 hours
    expect((await book(bar, { tableId: t1, ...ok, guestName: '  ' })).statusCode).toBe(400);
    expect((await book(bar, { tableId: t1, ...ok, partySize: 0 })).statusCode).toBe(400);
    expect((await book(bar, { tableId: 'nope', ...ok })).statusCode).toBe(400);
    expect((await book(bar, { tableId: t1, startsAt: 'tomorrow', endsAt: ok.endsAt })).statusCode).toBe(400);
    expect((await call('GET', '/api/v1/bar/bookings?date=soon', bar)).statusCode).toBe(400);
    expect((await call('GET', '/api/v1/bar/bookings?date=2030-01-01&days=15', bar)).statusCode).toBe(400);
  });

  it('404 for an unknown table, member or booking; 422 for a switched-off table or a time in the past', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const ok = slot(3, 10);
    expect((await book(bar, { tableId: NO_SUCH_UUID, ...ok })).statusCode).toBe(404);
    expect((await book(bar, { tableId: t1, ...ok, memberId: NO_SUCH_UUID })).statusCode).toBe(404);
    expect((await call('PUT', `/api/v1/bar/bookings/${NO_SUCH_UUID}`, bar, { guestName: 'x' })).statusCode).toBe(404);
    expect((await call('DELETE', `/api/v1/bar/bookings/${NO_SUCH_UUID}`, bar)).statusCode).toBe(404);
    const unavailable = await book(bar, { tableId: off, ...ok });
    expect(unavailable.statusCode).toBe(422);
    expect(unavailable.json().code).toBe('TABLE_UNAVAILABLE');
    const past = await book(bar, { tableId: t1, ...slot(-2, 10) });
    expect(past.statusCode).toBe(422);
    expect(past.json().code).toBe('BOOKING_IN_PAST');
  });

  it('books a table, lists it by club day and keeps it out of other days', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const w = slot(10, 12);
    const created = await book(bar, { tableId: t1, guestName: 'Asha', partySize: 4, notes: 'Birthday', ...w });
    expect(created.statusCode).toBe(201);
    const booking = TableBookingSchema.parse(created.json());
    expect(booking).toMatchObject({ guestName: 'Asha', partySize: 4, status: 'BOOKED', tableId: t1, notes: 'Birthday' });
    expect(booking.tableName).toBe(`${PREFIX}-A`);

    const day = w.startsAt.slice(0, 10);
    const listed = TableBookingListSchema.parse((await call('GET', `/api/v1/bar/bookings?date=${day}&days=2&tableId=${t1}`, bar)).json());
    expect(listed.map((b) => b.id)).toContain(booking.id);
    const other = TableBookingListSchema.parse((await call('GET', `/api/v1/bar/bookings?date=2031-01-01&tableId=${t1}`, owner)).json());
    expect(other.map((b) => b.id)).not.toContain(booking.id);
  });

  it('409 on overlap, but back-to-back and other tables are fine', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const first = slot(11, 10, 2); // 10:00 to 12:00
    expect((await book(bar, { tableId: t1, ...first })).statusCode).toBe(201);

    const clash = await book(bar, { tableId: t1, ...slot(11, 11, 2) }); // 11:00 to 13:00
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('TABLE_BOOKING_CONFLICT');
    expect((await book(bar, { tableId: t1, ...slot(11, 9, 3) })).statusCode).toBe(409); // swallows the start
    expect((await book(bar, { tableId: t1, ...slot(11, 10, 1) })).statusCode).toBe(409); // inside it

    expect((await book(bar, { tableId: t1, ...slot(11, 12, 2) })).statusCode).toBe(201); // starts exactly when it ends
    expect((await book(bar, { tableId: t1, ...slot(11, 8, 2) })).statusCode).toBe(201); // ends exactly when it starts
    expect((await book(bar, { tableId: t2, ...first })).statusCode).toBe(201); // same time, different table
  });

  it('only one of two simultaneous bookings for the same slot wins', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const w = slot(12, 18);
    const results = await Promise.all([1, 2, 3].map((i) => book(bar, { tableId: t2, guestName: `Racer ${i}`, ...w })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
  });

  it('moves and resizes a booking, refusing a move or extension into another booking', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const a = (await book(bar, { tableId: t1, guestName: 'A', ...slot(13, 10, 1) })).json();
    const b = (await book(bar, { tableId: t1, guestName: 'B', ...slot(13, 12, 1) })).json();

    // Extending A to 12:00 is fine (touches B), to 13:00 is not.
    const ext = await call('PUT', `/api/v1/bar/bookings/${a.id}`, bar, { endsAt: slot(13, 12, 1).startsAt });
    expect(ext.statusCode).toBe(200);
    const tooFar = await call('PUT', `/api/v1/bar/bookings/${a.id}`, bar, { endsAt: slot(13, 13, 1).startsAt });
    expect(tooFar.statusCode).toBe(409);
    expect(tooFar.json().code).toBe('TABLE_BOOKING_CONFLICT');

    // A booking never conflicts with itself: shifting it by 30 minutes within its own window is fine.
    const shifted = slot(13, 10, 2);
    const nudged = await call('PUT', `/api/v1/bar/bookings/${a.id}`, bar, {
      startsAt: new Date(Date.parse(shifted.startsAt) - 30 * 60_000).toISOString(),
      endsAt: new Date(Date.parse(shifted.startsAt) + 90 * 60_000).toISOString(),
    });
    expect(nudged.statusCode).toBe(200);

    // Moving B onto the other table at the same time works; onto A's slot on table 1 does not.
    expect((await call('PUT', `/api/v1/bar/bookings/${b.id}`, bar, { tableId: t2 })).json().tableId).toBe(t2);
    const back = await call('PUT', `/api/v1/bar/bookings/${b.id}`, bar, { tableId: t1, ...slot(13, 11, 1) });
    expect(back.statusCode).toBe(409);
    expect((await call('PUT', `/api/v1/bar/bookings/${b.id}`, bar, { tableId: off })).statusCode).toBe(422);
    expect((await call('PUT', `/api/v1/bar/bookings/${b.id}`, bar, { ...slot(-3, 10) })).statusCode).toBe(422);
  });

  it('walks BOOKED to SEATED to COMPLETED and refuses skipping or reopening', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = (await book(bar, { tableId: t2, guestName: 'Flow', ...slot(14, 10, 1) })).json();
    const put = (payload: object) => call('PUT', `/api/v1/bar/bookings/${created.id}`, bar, payload);
    const skip = await put({ status: 'COMPLETED' });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().code).toBe('INVALID_BOOKING_STATUS');
    expect((await put({ status: 'SEATED' })).json().status).toBe('SEATED');
    expect((await put({ status: 'COMPLETED' })).json().status).toBe('COMPLETED');
    const closed = await put({ guestName: 'Late edit' });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().code).toBe('BOOKING_CLOSED');
    expect((await call('DELETE', `/api/v1/bar/bookings/${created.id}`, bar)).statusCode).toBe(409);
  });

  it('cancelling frees the slot, hides the booking from the timeline and keeps it as history', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const w = slot(15, 10, 2);
    const created = (await book(bar, { tableId: t1, guestName: 'Cancelled', ...w })).json();
    const cancelled = await call('DELETE', `/api/v1/bar/bookings/${created.id}`, bar);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('CANCELLED');

    const day = w.startsAt.slice(0, 10);
    const hidden = TableBookingListSchema.parse((await call('GET', `/api/v1/bar/bookings?date=${day}&tableId=${t1}`, bar)).json());
    expect(hidden.map((x) => x.id)).not.toContain(created.id);
    const history = TableBookingListSchema.parse((await call('GET', `/api/v1/bar/bookings?date=${day}&tableId=${t1}&includeClosed=true`, bar)).json());
    expect(history.map((x) => x.id)).toContain(created.id);

    expect((await book(bar, { tableId: t1, guestName: 'Replacement', ...w })).statusCode).toBe(201);
  });
});
