import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@packages/db';
import { hashSessionToken } from '@packages/auth';
import { AvailabilitySchema, CourtListSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { addDays, clubDateOf, clubWallTimeToInstant } from './services/time.js';
import { isDatabaseAvailable } from './test-support/database.js';
import {
  FixtureTracker,
  createBooking,
  createCourt,
  createCourtType,
  createMember,
  createMembership,
  createPlan,
  createUserWithPolicy,
} from './test-support/court-fixtures.js';

const IST = 'Asia/Kolkata';
const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000aa';

describe('Court & availability routes', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const tracker = new FixtureTracker();

  const today = clubDateOf(new Date(), IST);
  const tomorrow = addDays(today, 1);

  // Fixture state (filled in beforeAll when a database is available).
  let typeId = '';
  let courtId = '';
  let courtName = '';
  let memberId = '';
  let otherMemberId = '';
  let bookingId = '';
  const cookies: Record<'member' | 'frontDesk' | 'owner' | 'bar' | 'suspended', string> = {
    member: '',
    frontDesk: '',
    owner: '',
    bar: '',
    suspended: '',
  };

  async function login(userId: string): Promise<string> {
    const { sessionToken } = await app.sessionManager.createSession({ userId });
    return `${app.env.SESSION_COOKIE_NAME}=${sessionToken}`;
  }

  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;

    const db = getDb();
    const type = await createCourtType(db);
    const court = await createCourt(db, type.id, 'Route Court');
    tracker.courtTypeIds.push(type.id);
    tracker.courtIds.push(court.id);
    typeId = type.id;
    courtId = court.id;
    courtName = court.name;

    const plan = await createPlan(db, { courtDiscountPct: 30, bookingHorizonDays: 7, maxBookingsPerDay: 2 });
    tracker.planIds.push(plan.id);

    const member = await createUserWithPolicy(db, 'MemberPolicy');
    const frontDesk = await createUserWithPolicy(db, 'FrontDeskPolicy');
    const owner = await createUserWithPolicy(db, 'OwnerPolicy');
    const bar = await createUserWithPolicy(db, 'BarStaffPolicy');
    const suspended = await createUserWithPolicy(db, 'MemberPolicy');
    for (const entry of [member, frontDesk, owner, bar, suspended]) {
      tracker.userIds.push(entry.user.id);
      tracker.policyIds.push(entry.policyId);
    }

    const memberRow = await createMember(db, { userId: member.user.id, fullName: 'Route Member' });
    const otherMember = await createMember(db, { fullName: 'Someone Else' });
    tracker.memberIds.push(memberRow.id, otherMember.id);
    memberId = memberRow.id;
    otherMemberId = otherMember.id;
    await createMembership(db, { memberId, planId: plan.id, startsOn: addDays(today, -5), endsOn: addDays(today, 30) });

    const booking = await createBooking(db, {
      courtId,
      startsAt: clubWallTimeToInstant(tomorrow, 10 * 60, IST),
      bookingDate: tomorrow,
      memberId: otherMemberId,
    });
    bookingId = booking.id;

    cookies.member = await login(member.user.id);
    cookies.frontDesk = await login(frontDesk.user.id);
    cookies.owner = await login(owner.user.id);
    cookies.bar = await login(bar.user.id);
    cookies.suspended = await login(suspended.user.id);
    await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, suspended.user.id));
    // Suspending straight in the database leaves the Redis-cached session untouched (see PR notes), so
    // evict it to exercise the database path that real session validation falls back to.
    await app.redis.delete(`session:${hashSessionToken(cookies.suspended.split('=')[1])}`);
  });

  afterAll(async () => {
    if (hasDatabase) await tracker.cleanup(getDb());
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('GET /api/v1/courts', () => {
    it('401 without a session', async () => {
      const res = await get('/api/v1/courts');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED', requestId: expect.any(String) });
    });

    it('a suspended account is denied (401: its session no longer validates)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get('/api/v1/courts', cookies.suspended);
      expect(res.statusCode).toBe(401);
    });

    it.each(['member', 'frontDesk', 'owner', 'bar'] as const)('200 with the contract shape for %s', async (who, ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get('/api/v1/courts', cookies[who]);
      expect(res.statusCode).toBe(200);
      const list = CourtListSchema.parse(res.json());
      expect(list.find((c) => c.id === courtId)).toEqual({
        id: courtId,
        name: courtName,
        type: expect.stringMatching(/^T_/),
        typeName: expect.stringContaining('Test sport'),
        baseRatePaise: 60000,
        socialCapacity: 4,
        courtTypeId: typeId,
        sortOrder: expect.any(Number),
        isActive: true,
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('GET /api/v1/courts/availability', () => {
    const url = (extra = '', date = tomorrow) => `/api/v1/courts/availability?date=${date}&courtTypeId=${typeId || NO_SUCH_UUID}${extra}`;

    it('400 for a malformed or impossible date, a bad court type id and a missing date', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const query of ['', '?date=09-10-2026', '?date=2026-02-30', `?date=${tomorrow}&courtTypeId=not-a-uuid`, `?date=${tomorrow}&memberId=nope`]) {
        const res = await get(`/api/v1/courts/availability${query}`, cookies.frontDesk);
        expect(res.statusCode, query).toBe(400);
        expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });
      }
    });

    it('400 is raised before authentication, like every other validated route (never a 500)', async () => {
      const res = await get('/api/v1/courts/availability?date=bogus');
      expect(res.statusCode).toBe(400);
    });

    it('401 without a session', async () => {
      const res = await get(`/api/v1/courts/availability?date=${tomorrow}`);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('403 for bar staff; suspended members are denied', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const bar = await get(url(), cookies.bar);
      expect(bar.statusCode).toBe(403);
      expect(bar.json()).toMatchObject({ code: 'FORBIDDEN', requestId: expect.any(String) });
      const suspended = await get(url(), cookies.suspended);
      expect(suspended.statusCode).toBe(401);
    });

    it('200 for staff: contract shape, holder and bookingId visible, walk-in price', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      for (const who of ['frontDesk', 'owner'] as const) {
        const res = await get(url(), cookies[who]);
        expect(res.statusCode).toBe(200);
        expect(res.headers['x-request-id']).toBeTruthy();
        const body = AvailabilitySchema.parse(res.json());
        expect(body).toMatchObject({ date: tomorrow, timezone: IST, priceFor: { type: 'WALK_IN', label: 'Walk-in' } });
        expect(body.limits).toBeUndefined();
        expect(body.courts).toHaveLength(1);
        const [court] = body.courts;
        expect(court).toMatchObject({ courtId, name: courtName });
        const booked = court.slots.find((s) => s.startsAt === clubWallTimeToInstant(tomorrow, 10 * 60, IST).toISOString());
        expect(booked).toMatchObject({ status: 'BOOKED', bookingId, holder: 'Someone Else', pricePaise: 60000 });
        expect(court.slots.find((s) => s.startsAt === clubWallTimeToInstant(tomorrow, 10 * 60 + 30, IST).toISOString())?.status).toBe('BOOKED');
        expect(court.slots.find((s) => s.startsAt === clubWallTimeToInstant(tomorrow, 11 * 60, IST).toISOString())?.status).toBe('FREE');
        expect(court.slots.find((s) => s.startsAt === clubWallTimeToInstant(tomorrow, 9 * 60, IST).toISOString())?.status).toBe('FREE');
      }
    });

    it('200 for a member: priced as themselves, no holder details, daily-limit hint', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url(), cookies.member);
      expect(res.statusCode).toBe(200);
      const body = AvailabilitySchema.parse(res.json());
      expect(body.priceFor).toMatchObject({ type: 'MEMBER', memberId });
      expect(body.limits).toEqual({ usedToday: 0, maxPerDay: 2 });
      const slot = body.courts[0].slots.find((s) => s.startsAt === clubWallTimeToInstant(tomorrow, 10 * 60, IST).toISOString());
      expect(slot?.status).toBe('BOOKED');
      expect(slot).not.toHaveProperty('holder');
      expect(slot).not.toHaveProperty('bookingId');
      expect(body.courts[0].slots.find((s) => s.status === 'FREE')?.pricePaise).toBe(42000); // 30% off 600.00
    });

    it('front desk can price for a member via memberId', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url(`&memberId=${memberId}`), cookies.frontDesk);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.priceFor).toMatchObject({ type: 'MEMBER', memberId });
      expect(body.limits).toEqual({ usedToday: 0, maxPerDay: 2 });
      expect(body.courts[0].slots.find((s: { status: string }) => s.status === 'FREE').pricePaise).toBe(42000);
    });

    it('adversarial: a member cannot pass another memberId to read another plan\'s price (403)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url(`&memberId=${otherMemberId}`), cookies.member);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'FORBIDDEN', requestId: expect.any(String) });
      expect(JSON.stringify(res.json())).not.toContain('Someone Else');
    });

    it('404 when staff price for a member that does not exist', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url(`&memberId=${NO_SUCH_UUID}`), cookies.frontDesk);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    it('422 BEYOND_BOOKING_HORIZON for a member past their plan horizon (7 days) but not at the limit', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const tooFar = await get(url('', addDays(today, 8)), cookies.member);
      expect(tooFar.statusCode).toBe(422);
      expect(tooFar.json()).toMatchObject({ code: 'BEYOND_BOOKING_HORIZON', requestId: expect.any(String) });
      const atLimit = await get(url('', addDays(today, 7)), cookies.member);
      expect(atLimit.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('GET /api/v1/public/availability', () => {
    const url = (extra = '', date = tomorrow) => `/api/v1/public/availability?date=${date}&courtTypeId=${typeId || NO_SUCH_UUID}${extra}`;

    it('400 for a missing, malformed or impossible date and a bad court type id (no login needed)', async () => {
      for (const query of ['', '?date=tomorrow', '?date=2026-13-01', `?date=${tomorrow}&courtTypeId=xyz`]) {
        const res = await get(`/api/v1/public/availability${query}`);
        expect(res.statusCode, query).toBe(400);
        expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });
      }
    });

    it('422 BEYOND_BOOKING_HORIZON beyond the 7-day trial horizon', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url('', addDays(today, 8)));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: 'BEYOND_BOOKING_HORIZON', statusCode: 422, requestId: expect.any(String) });
    });

    it('200 without a cookie: contract shape, walk-in price, no booking details', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url('', addDays(today, 7)));
      expect(res.statusCode).toBe(200);
      const body = AvailabilitySchema.parse(res.json());
      expect(body).toMatchObject({ timezone: IST, priceFor: { type: 'WALK_IN', label: 'Walk-in' } });
      expect(body.courts).toHaveLength(1);
      expect(body.courts[0].slots.length).toBeGreaterThan(0);

      const tomorrowRes = await get(url());
      const slots = AvailabilitySchema.parse(tomorrowRes.json()).courts[0].slots;
      const booked = slots.find((s) => s.startsAt === clubWallTimeToInstant(tomorrow, 10 * 60, IST).toISOString());
      expect(booked?.status).toBe('BOOKED');
      expect(booked).not.toHaveProperty('bookingId');
      expect(booked).not.toHaveProperty('holder');
      expect(tomorrowRes.body).not.toContain('Someone Else');
      expect(tomorrowRes.body).not.toContain(bookingId);
    });

    it('adversarial: a logged-in cookie or memberId never changes the public price or leaks holders', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await get(url(`&memberId=${memberId}`), cookies.owner);
      expect(res.statusCode).toBe(200);
      const body = AvailabilitySchema.parse(res.json());
      expect(body.priceFor).toEqual({ type: 'WALK_IN', label: 'Walk-in' });
      expect(body.limits).toBeUndefined();
      expect(res.body).not.toContain('Someone Else');
      expect(body.courts[0].slots.find((s) => s.status === 'FREE')?.pricePaise).toBe(60000);
    });

    it('is rate limited to 30 requests per minute per IP', async () => {
      const limited = buildApp();
      await limited.ready();
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 31; i += 1) {
          // 400s still count against the limit, so this needs no database.
          const res = await limited.inject({ method: 'GET', url: '/api/v1/public/availability?date=bad' });
          statuses.push(res.statusCode);
        }
        expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
        expect(statuses[30]).toBe(429);
      } finally {
        await limited.close();
      }
    });
  });
});
