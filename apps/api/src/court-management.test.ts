import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { courtTypes, courts, getDb } from '@packages/db';
import { CourtListSchema, CourtTypeListSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { addDays, clubDateOf, clubWallTimeToInstant } from './services/time.js';
import { isDatabaseAvailable } from './test-support/database.js';
import {
  FixtureTracker,
  createBooking,
  createCourt,
  createCourtType,
  createMember,
  createUserWithPolicy,
  uniqueSuffix,
} from './test-support/court-fixtures.js';

const IST = 'Asia/Kolkata';
const NO_SUCH_UUID = '00000000-0000-4000-8000-0000000000cc';

describe('Court management (owner CRUD)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const tracker = new FixtureTracker();
  let typeId = '';
  let inactiveTypeId = '';
  const cookies = { owner: '', frontDesk: '', member: '', bar: '' };

  async function login(userId: string): Promise<string> {
    const { sessionToken } = await app.sessionManager.createSession({ userId });
    return `${app.env.SESSION_COOKIE_NAME}=${sessionToken}`;
  }

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });

  async function create(label: string, extra: object = {}) {
    const res = await call('POST', '/api/v1/courts', cookies.owner, {
      name: `${label} ${uniqueSuffix()}`,
      courtTypeId: typeId,
      ...extra,
    });
    if (res.statusCode === 201) tracker.courtIds.push(res.json().id);
    return res;
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    const db = getDb();
    const type = await createCourtType(db);
    const inactive = await createCourtType(db);
    await db.update(courtTypes).set({ isActive: false }).where(eq(courtTypes.id, inactive.id));
    tracker.courtTypeIds.push(type.id, inactive.id);
    typeId = type.id;
    inactiveTypeId = inactive.id;

    for (const [key, policy] of [
      ['owner', 'OwnerPolicy'],
      ['frontDesk', 'FrontDeskPolicy'],
      ['member', 'MemberPolicy'],
      ['bar', 'BarStaffPolicy'],
    ] as const) {
      const entry = await createUserWithPolicy(db, policy);
      tracker.userIds.push(entry.user.id);
      tracker.policyIds.push(entry.policyId);
      cookies[key] = await login(entry.user.id);
    }
  });

  afterAll(async () => {
    if (hasDatabase) await tracker.cleanup(getDb());
    await app.close();
  });

  it('401 without a session on every management route', async () => {
    expect((await call('GET', '/api/v1/court-types')).statusCode).toBe(401);
    expect((await call('POST', '/api/v1/courts', undefined, { name: 'X', courtTypeId: NO_SUCH_UUID })).statusCode).toBe(401);
    expect((await call('PUT', `/api/v1/courts/${NO_SUCH_UUID}`, undefined, { name: 'X' })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/v1/courts/${NO_SUCH_UUID}`)).statusCode).toBe(401);
  });

  it('403 for members, front desk and bar staff: only the owner manages courts', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const who of ['member', 'frontDesk', 'bar'] as const) {
      expect((await call('GET', '/api/v1/court-types', cookies[who])).statusCode).toBe(403);
      expect((await call('POST', '/api/v1/courts', cookies[who], { name: 'Nope', courtTypeId: typeId })).statusCode).toBe(403);
      expect((await call('PUT', `/api/v1/courts/${NO_SUCH_UUID}`, cookies[who], { name: 'Nope' })).statusCode).toBe(403);
      expect((await call('DELETE', `/api/v1/courts/${NO_SUCH_UUID}`, cookies[who])).statusCode).toBe(403);
    }
  });

  it('400 for an empty or oversized name and a malformed sport id', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const payload of [
      { name: '   ', courtTypeId: typeId },
      { name: 'x'.repeat(65), courtTypeId: typeId },
      { name: 'Court', courtTypeId: 'not-a-uuid' },
      { courtTypeId: typeId },
    ]) {
      expect((await call('POST', '/api/v1/courts', cookies.owner, payload)).statusCode).toBe(400);
    }
  });

  it('lists the sports for the owner', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await call('GET', '/api/v1/court-types', cookies.owner);
    expect(res.statusCode).toBe(200);
    expect(CourtTypeListSchema.parse(res.json()).find((t) => t.id === typeId)).toMatchObject({ isActive: true });
  });

  it('creates a court that then appears in the courts list', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await create('Create', { sortOrder: 7 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ courtTypeId: typeId, sortOrder: 7, isActive: true });
    const list = CourtListSchema.parse((await call('GET', '/api/v1/courts', cookies.member)).json());
    expect(list.some((c) => c.id === res.json().id)).toBe(true);
  });

  it('404 for an unknown sport and 422 for a switched-off sport', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await call('POST', '/api/v1/courts', cookies.owner, { name: 'Ghost sport', courtTypeId: NO_SUCH_UUID })).statusCode).toBe(404);
    const off = await call('POST', '/api/v1/courts', cookies.owner, { name: `Off sport ${uniqueSuffix()}`, courtTypeId: inactiveTypeId });
    expect(off.statusCode).toBe(422);
  });

  it('409 for a duplicate name on create and rename', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const first = await create('Dup');
    const second = await create('Dup');
    const clash = await call('POST', '/api/v1/courts', cookies.owner, { name: first.json().name, courtTypeId: typeId });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ code: 'CONFLICT' });
    const rename = await call('PUT', `/api/v1/courts/${second.json().id}`, cookies.owner, { name: first.json().name });
    expect(rename.statusCode).toBe(409);
  });

  it('updates the name, order and active flag, and 404s on unknown courts', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = (await create('Edit')).json().id as string;
    const res = await call('PUT', `/api/v1/courts/${id}`, cookies.owner, { name: `Renamed ${uniqueSuffix()}`, sortOrder: 3, isActive: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, sortOrder: 3, isActive: false });
    expect((await call('PUT', `/api/v1/courts/${NO_SUCH_UUID}`, cookies.owner, { name: 'Missing' })).statusCode).toBe(404);
    expect((await call('DELETE', `/api/v1/courts/${NO_SUCH_UUID}`, cookies.owner)).statusCode).toBe(404);
  });

  it('deletes a court with no history outright', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = (await create('Gone')).json().id as string;
    const res = await call('DELETE', `/api/v1/courts/${id}`, cookies.owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true, deactivated: false });
    expect(await getDb().select().from(courts).where(eq(courts.id, id))).toHaveLength(0);
  });

  it('409 when switching off or deleting a court that has upcoming bookings', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const db = getDb();
    const court = await createCourt(db, typeId, 'Busy');
    tracker.courtIds.push(court.id);
    const today = clubDateOf(new Date(), IST);
    const tomorrow = addDays(today, 1);
    const member = await createMember(db, { fullName: 'Court Mgmt Member' });
    tracker.memberIds.push(member.id);
    await createBooking(db, {
      courtId: court.id,
      startsAt: clubWallTimeToInstant(tomorrow, 10 * 60, IST),
      bookingDate: tomorrow,
      memberId: member.id,
    });

    const off = await call('PUT', `/api/v1/courts/${court.id}`, cookies.owner, { isActive: false });
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ code: 'COURT_HAS_BOOKINGS' });
    expect((await call('DELETE', `/api/v1/courts/${court.id}`, cookies.owner)).statusCode).toBe(409);
    expect(await db.select().from(courts).where(eq(courts.id, court.id))).toHaveLength(1);
  });

  it('switches off, instead of deleting, a court with only past bookings', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const db = getDb();
    const court = await createCourt(db, typeId, 'History');
    tracker.courtIds.push(court.id);
    const today = clubDateOf(new Date(), IST);
    const lastWeek = addDays(today, -7);
    const member = await createMember(db, { fullName: 'Court History Member' });
    tracker.memberIds.push(member.id);
    await createBooking(db, {
      courtId: court.id,
      startsAt: clubWallTimeToInstant(lastWeek, 10 * 60, IST),
      bookingDate: lastWeek,
      memberId: member.id,
    });

    const res = await call('DELETE', `/api/v1/courts/${court.id}`, cookies.owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: false, deactivated: true });
    const [row] = await db.select().from(courts).where(eq(courts.id, court.id));
    expect(row.isActive).toBe(false);
  });
});
