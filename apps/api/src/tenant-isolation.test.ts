import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, plans, systemAuditLogs, tenantDomains, tenants, users } from '@packages/db';
import { buildApp } from './app.js';
import { addDays, clubDateOf } from './lib/club-date.js';
import { clubWallTimeToInstant } from './services/time.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

/**
 * Data isolation between clubs (#69, piece B). Two real clubs are created through the platform API and
 * filled through the public API with the SAME names, codes, SKUs and phone-free identities, then every
 * read and write is attempted from one club against the other's rows. Row level security must make the
 * other club's data not just forbidden but invisible: lookups are 404, lists and totals count only the
 * caller's own rows, and nothing the caller sends can touch a foreign row.
 */

const RUN = randomUUID().slice(0, 8);
const IST = 'Asia/Kolkata';
const today = clubDateOf(new Date(), IST);
const at = (offset: number, hour: number): string => clubWallTimeToInstant(addDays(today, offset), hour * 60, IST).toISOString();

interface Club {
  key: 'A' | 'B';
  id: string;
  host: string;
  owner: Actor;
  ids: Record<string, string>;
  ownerUserId: string;
  marker: string;
  planFeePaise: number;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const REFUSED = [400, 403, 404, 409, 422];

describe('Tenant data isolation (database)', () => {
  const db = getDb();
  let app: FastifyInstance;
  let available = false;
  let storageUp = false;
  const fx = new MembersFixtures();
  let root: Actor;
  let A: Club;
  let B: Club;

  const call = (club: Club, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, cookie: string = club.owner.cookie) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { 'x-tenant-host': club.host, ...(cookie ? { cookie } : {}) },
      ...(payload ? { payload } : {}),
    });
  const asPlatform = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { cookie: root.cookie }, ...(payload ? { payload } : {}) });

  const ok = async (res: Awaited<ReturnType<typeof call>>, status: number) => {
    expect(res.statusCode, res.body).toBe(status);
    return res.json();
  };
  const rowsOf = (body: { data?: Array<{ id: string }> } | Array<{ id: string }>) => (Array.isArray(body) ? body : (body.data ?? []));

  /** Creates a club through the platform API, claims a host for it and signs up its own owner. */
  async function makeClub(key: 'A' | 'B', planFeePaise: number): Promise<Club> {
    const created = await ok(await asPlatform('POST', '/platform/tenants', { slug: `iso${RUN}-${key.toLowerCase()}`, name: `Isolation ${key}` }), 201);
    const host = `club-${key.toLowerCase()}-${RUN}.example.org`;
    await db.insert(tenantDomains).values({ tenantId: created.id, domain: host, status: 'VERIFIED', verificationToken: 'x', verifiedAt: new Date() });
    const owner = await fx.actor(app, 'OWNER', host);
    return { key, id: created.id, host, owner, ids: {}, ownerUserId: owner.id, marker: `Marker${key}${RUN}`, planFeePaise };
  }

  /** Fills one club with a row in (nearly) every club-owned table, using the same names in both clubs. */
  async function seedClub(c: Club) {
    const post = async (url: string, body: object, pick: (j: any) => string = (j) => j.id) => pick(await ok(await call(c, 'POST', url, body), 201));
    const [plan] = await db
      .insert(plans)
      .values({ tenantId: c.id, code: 'GOLD', name: `Gold ${c.marker}`, monthlyFeePaise: c.planFeePaise, courtDiscountPct: 10, shopDiscountPct: 5, barDiscountPct: 5 })
      .returning();
    c.ids.plan = plan.id;
    c.ids.courtType = await post('/court-types', { code: 'PADEL', name: `Padel ${c.marker}`, baseRatePaise: 60000, socialFeePaise: 0, trialFeePaise: 0, socialCapacity: 0 });
    c.ids.court = await post('/courts', { name: 'Court 1', courtTypeId: c.ids.courtType });
    c.ids.product = await post('/products', { sku: 'SKU-1', name: `Racket ${c.marker}`, category: 'RACKET', pricePaise: 1000, stockQty: 5 });
    c.ids.barTable = await post('/bar/tables', { name: 'T1', seats: 4 });
    c.ids.menuItem = await post('/bar/menu', { name: `Chai ${c.marker}`, category: 'DRINK', station: 'BAR', pricePaise: 100 });
    c.ids.lead = await post('/crm/leads', { name: `Lead ${c.marker}`, phone: c.key === 'A' ? '+919800000001' : '+919800000002', source: 'WALK_IN' });
    c.ids.businessClient = await post('/business-clients', { companyName: `Co ${c.marker}` });
    c.ids.employee = await post('/hr/employees', { fullName: `Emp ${c.marker}`, position: 'Barista', department: 'BAR', monthlySalaryPaise: 100000, hiredOn: '2026-01-01' });
    const member = await ok(
      await call(c, 'POST', '/members', { fullName: `Member ${c.marker}`, phone: c.key === 'A' ? '+919811111111' : '+919822222222', planId: c.ids.plan, paymentMethod: 'CASH' }),
      201
    );
    c.ids.member = member.member.id;
    c.ids.invoice = member.invoice.id;
    c.ids.payment = member.payment.id;
    c.ids.booking = await post('/bookings', { courtId: c.ids.court, startsAt: at(1, 10), guest: { name: `Guest ${c.marker}`, phone: c.key === 'A' ? '+919833333331' : '+919833333332' } });
  }

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    storageUp = (await app.storage.healthCheck()).status === 'ok';
    if (!available) return;
    // The platform operator (ROOT), signed in fresh so the session carries the ROOT identity.
    const operator = await fx.actor(app, 'OWNER');
    await db.update(users).set({ identityType: 'ROOT' }).where(eq(users.id, operator.id));
    const [{ email }] = await db.select({ email: users.email }).from(users).where(eq(users.id, operator.id));
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Password123!' } });
    root = { id: operator.id, cookie: `app_session=${login.cookies.find((x) => x.name === 'app_session')!.value}` };
    A = await makeClub('A', 111100);
    B = await makeClub('B', 777700);
    await seedClub(A);
    await seedClub(B);
  }, 60_000);

  afterAll(async () => {
    if (available && A && B) {
      const both = [A.id, B.id];
      const tables = (await db.execute(sql`select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'`)) as unknown as Array<{ t: string }>;
      // Foreign keys decide the order; keep sweeping until every club-owned row is gone.
      for (let pass = 0; pass < 12; pass += 1) {
        let failed = 0;
        for (const { t } of tables) {
          try {
            await db.execute(sql`delete from ${sql.identifier(t)} where tenant_id in (${sql.join(both.map((id) => sql`${id}::uuid`), sql`, `)})`);
          } catch {
            failed += 1;
          }
        }
        if (failed === 0) break;
      }
      await db.delete(systemAuditLogs).where(inArray(systemAuditLogs.tenantId, both));
      await db.delete(tenants).where(inArray(tenants.id, both));
    }
    if (available) await fx.cleanup();
    await app.close();
  });

  const clubs = () => [
    { me: A, other: B },
    { me: B, other: A },
  ];

  // ---------------------------------------------------------------------------------- reads

  const ENTITIES: Array<{ name: string; list: string; id: string; get?: string; update?: [method: 'PUT' | 'PATCH', url: string, body: object]; remove?: string }> = [
    { name: 'court types', list: '/court-types', id: 'courtType', update: ['PUT', '/court-types/:id', { name: 'Hijacked' }] },
    { name: 'courts', list: '/courts', id: 'court', update: ['PUT', '/courts/:id', { name: 'Hijacked' }], remove: '/courts/:id' },
    { name: 'products', list: '/products', id: 'product', get: '/products/:id', update: ['PUT', '/products/:id', { name: 'Hijacked' }], remove: '/products/:id' },
    { name: 'bar tables', list: '/bar/tables', id: 'barTable', update: ['PUT', '/bar/tables/:id', { name: 'Hijacked' }], remove: '/bar/tables/:id' },
    { name: 'menu items', list: '/bar/menu', id: 'menuItem', update: ['PUT', '/bar/menu/:id', { name: 'Hijacked' }] },
    { name: 'leads', list: '/crm/leads', id: 'lead', get: '/crm/leads/:id', update: ['PATCH', '/crm/leads/:id', { status: 'CONTACTED' }] },
    { name: 'business clients', list: '/business-clients', id: 'businessClient' },
    { name: 'employees', list: '/hr/employees', id: 'employee', get: '/hr/employees/:id', update: ['PUT', '/hr/employees/:id', { position: 'Hijacked' }] },
    { name: 'members', list: '/members', id: 'member', get: '/members/:id', update: ['PATCH', '/members/:id', { fullName: 'Hijacked' }] },
    { name: 'bookings', list: '/bookings', id: 'booking', get: '/bookings/:id' },
    { name: 'invoices', list: '/invoices', id: 'invoice', get: '/invoices/:id' },
  ];

  it('seeded the same names in both clubs (uniqueness is per club)', async (ctx) => {
    if (!available) return ctx.skip();
    // Both clubs got PADEL / Court 1 / SKU-1 / T1 / GOLD; inside one club the duplicate is still refused.
    for (const { me } of clubs()) {
      expect((await call(me, 'POST', '/court-types', { code: 'PADEL', name: 'Again', baseRatePaise: 1000 })).statusCode).toBe(409);
      expect((await call(me, 'POST', '/courts', { name: 'Court 1', courtTypeId: me.ids.courtType })).statusCode).toBe(409);
      expect((await call(me, 'POST', '/products', { sku: 'SKU-1', name: 'Again', category: 'RACKET', pricePaise: 1, stockQty: 1 })).statusCode).toBe(409);
      expect((await call(me, 'POST', '/bar/tables', { name: 'T1', seats: 2 })).statusCode).toBe(409);
    }
    expect(A.ids.court).not.toBe(B.ids.court);
  });

  for (const e of ENTITIES) {
    it(`${e.name}: lists hold only the caller's rows and a foreign id is 404`, async (ctx) => {
      if (!available) return ctx.skip();
      for (const { me, other } of clubs()) {
        const rows = rowsOf(await ok(await call(me, 'GET', `${e.list}?limit=100`), 200));
        const ids = rows.map((r) => r.id);
        expect(ids, `${e.name} in ${me.key}`).toContain(me.ids[e.id]);
        expect(ids, `${e.name} of ${other.key} leaked into ${me.key}`).not.toContain(other.ids[e.id]);
        if (e.get) {
          expect((await call(me, 'GET', e.get.replace(':id', me.ids[e.id]))).statusCode).toBe(200);
          expect((await call(me, 'GET', e.get.replace(':id', other.ids[e.id]))).statusCode, `${e.name} get`).toBe(404);
        }
      }
    });

    if (e.update || e.remove) {
      it(`${e.name}: updates and deletes of the other club's row are 404 and change nothing`, async (ctx) => {
        if (!available) return ctx.skip();
        for (const { me, other } of clubs()) {
          const before = JSON.stringify(rowsOf(await ok(await call(other, 'GET', `${e.list}?limit=100`), 200)));
          if (e.update) {
            const [method, url, body] = e.update;
            expect((await call(me, method, url.replace(':id', other.ids[e.id]), body)).statusCode, `${method} ${url}`).toBe(404);
          }
          if (e.remove) expect((await call(me, 'DELETE', e.remove.replace(':id', other.ids[e.id]))).statusCode, `DELETE ${e.remove}`).toBe(404);
          expect(JSON.stringify(rowsOf(await ok(await call(other, 'GET', `${e.list}?limit=100`), 200)))).toBe(before);
        }
      });
    }
  }

  it('totals count only the caller\'s rows (members, products, leads, overview, revenue)', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      for (const list of ['/members', '/products', '/crm/leads', '/hr/employees']) {
        const body = await ok(await call(me, 'GET', `${list}?limit=100`), 200);
        const rows = rowsOf(body) as Array<Record<string, unknown>>;
        expect(JSON.stringify(rows), `${list} leaked ${other.marker}`).not.toContain(other.marker);
        if (body.meta?.total !== undefined) expect(body.meta.total, list).toBe(rows.length);
      }
      expect((await ok(await call(me, 'GET', '/crm/summary'), 200)).byStatus.NEW).toBe(1);
      const overview = await ok(await call(me, 'GET', '/reports/overview'), 200);
      const upcoming = overview.upcomingBookings.map((b: { id: string }) => b.id);
      expect(upcoming).toEqual([me.ids.booking]);
      expect(upcoming).not.toContain(other.ids.booking);
      // Revenue: each club only ever sees its own member sign-up payment.
      const csv = (await call(me, 'GET', '/reports/export.csv?range=month')).body;
      expect(csv).not.toContain(String(other.planFeePaise / 100));
      const payments = rowsOf(await ok(await call(me, 'GET', '/payments?limit=100'), 200)) as Array<{ id: string; amountPaise: number }>;
      expect(payments.map((p) => p.id)).toContain(me.ids.payment);
      expect(payments.map((p) => p.id)).not.toContain(other.ids.payment);
      expect(payments.every((p) => p.amountPaise !== other.planFeePaise)).toBe(true);
    }
  });

  it('search never reaches the other club (members, products, leads)', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      for (const list of ['/members', '/products', '/crm/leads']) {
        expect(rowsOf(await ok(await call(me, 'GET', `${list}?q=${other.marker}`), 200)), list).toHaveLength(0);
        expect(rowsOf(await ok(await call(me, 'GET', `${list}?q=${me.marker}`), 200)).length, list).toBeGreaterThan(0);
      }
      expect((await ok(await call(me, 'GET', `/members/lookup?q=${other.marker}`), 200)).data ?? []).toHaveLength(0);
    }
  });

  it('public pages show only the host\'s club', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      const body = (await call(me, 'GET', '/public/products', undefined, '')).body;
      expect(body).toContain(me.marker);
      expect(body).not.toContain(other.marker);
      const planList = (await call(me, 'GET', '/public/plans', undefined, '')).body;
      expect(planList).toContain(me.marker);
      expect(planList).not.toContain(other.marker);
      expect((await call(me, 'GET', '/tenant', undefined, '')).json().slug).toBe(`iso${RUN}-${me.key.toLowerCase()}`);
    }
  });

  // ---------------------------------------------------------------------------------- writes

  it('rows cannot reference another club\'s court, member, plan, employee or product', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      const attempts: Array<[string, 'POST' | 'PUT' | 'PATCH', string, object]> = [
        ['court with foreign type', 'POST', '/courts', { name: `X ${randomUUID().slice(0, 6)}`, courtTypeId: other.ids.courtType }],
        ['court moved to foreign type', 'PUT', `/courts/${me.ids.court}`, { courtTypeId: other.ids.courtType }],
        ['member on foreign plan', 'POST', '/members', { fullName: 'Cross Plan', phone: '+919844444444', planId: other.ids.plan, paymentMethod: 'CASH' }],
        ['booking on foreign court', 'POST', '/bookings', { courtId: other.ids.court, startsAt: at(2, 10), guest: { name: 'Cross', phone: '+919855555555' } }],
        ['booking for foreign member', 'POST', '/bookings', { courtId: me.ids.court, startsAt: at(2, 12), memberId: other.ids.member }],
        ['lead interested in foreign plan', 'POST', '/crm/leads', { name: 'Cross Lead', phone: '+919866666666', source: 'PHONE', interestedPlanId: other.ids.plan }],
        ['employee linked to foreign user', 'POST', '/hr/employees', { fullName: 'Cross Emp', position: 'x', department: 'BAR', monthlySalaryPaise: 1, hiredOn: '2026-01-01', userId: other.ownerUserId }],
        ['invoice for foreign member', 'POST', '/invoices', { memberId: other.ids.member, lines: [{ description: 'x', quantity: 1, unitPricePaise: 100, taxPct: 0 }] }],
      ];
      for (const [label, method, url, body] of attempts) {
        const res = await call(me, method, url, body);
        expect(REFUSED, `${label}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
      }
      // Nothing was created or changed on either side.
      expect(rowsOf(await ok(await call(me, 'GET', '/courts?limit=100'), 200))).toHaveLength(1);
      expect(rowsOf(await ok(await call(me, 'GET', '/members?limit=100'), 200))).toHaveLength(1);
      expect(rowsOf(await ok(await call(me, 'GET', '/bookings?limit=100'), 200))).toHaveLength(1);
      expect(rowsOf(await ok(await call(me, 'GET', '/crm/leads?limit=100'), 200))).toHaveLength(1);
      expect(rowsOf(await ok(await call(me, 'GET', '/hr/employees?limit=100'), 200))).toHaveLength(1);
      expect(rowsOf(await ok(await call(other, 'GET', '/members?limit=100'), 200))).toHaveLength(1);
    }
  });

  it('one club cannot book, cancel or pay the other club\'s booking', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      for (const action of ['cancel', 'no-show', 'complete']) {
        expect((await call(me, 'POST', `/bookings/${other.ids.booking}/${action}`, {})).statusCode, action).toBe(404);
      }
      expect((await call(me, 'POST', `/bookings/${other.ids.booking}/pay`, { method: 'CASH' })).statusCode).toBe(404);
      expect((await ok(await call(other, 'GET', `/bookings/${other.ids.booking}`), 200)).status).not.toBe('CANCELLED');
      // The same slot on the same-named court is free in each club (availability is per club).
      expect((await call(me, 'POST', '/bookings', { courtId: me.ids.court, startsAt: at(2, 14), guest: { name: 'Twin', phone: '+919877777777' } })).statusCode).toBe(201);
    }
  });

  it('IAM users, roles and notifications are per club', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      const users = rowsOf(await ok(await call(me, 'GET', '/iam/users?limit=100'), 200)) as Array<{ id: string }>;
      expect(users.map((u) => u.id)).toContain(me.ownerUserId);
      expect(users.map((u) => u.id)).not.toContain(other.ownerUserId);
      expect((await call(me, 'GET', `/iam/users/${other.ownerUserId}`)).statusCode).toBe(404);
      expect((await call(me, 'PUT', `/iam/users/${other.ownerUserId}/status`, { status: 'SUSPENDED' })).statusCode).toBe(404);
      expect((await call(other, 'GET', `/iam/users/${other.ownerUserId}`)).statusCode).toBe(200);
      const notes = await ok(await call(me, 'GET', '/notifications?limit=100'), 200);
      expect(JSON.stringify(notes)).not.toContain(other.marker);
    }
  });

  // ---------------------------------------------------------------------------------- sessions

  it('a session from one club is rejected on every other club\'s host', async (ctx) => {
    if (!available) return ctx.skip();
    for (const { me, other } of clubs()) {
      expect((await call(me, 'GET', '/auth/session')).statusCode).toBe(200);
      const crossSession = await call(other, 'GET', '/auth/session', undefined, me.owner.cookie);
      expect(crossSession.statusCode, crossSession.body).toBe(401);
      for (const url of ['/members', '/courts', '/hr/employees', '/iam/users', '/reports/overview']) {
        const res = await call(other, 'GET', url, undefined, me.owner.cookie);
        expect([401, 403], `${url} -> ${res.statusCode}`).toContain(res.statusCode);
      }
      expect((await call(other, 'POST', '/courts', { name: 'Intruder', courtTypeId: other.ids.courtType }, me.owner.cookie)).statusCode).toBeGreaterThanOrEqual(401);
      expect(rowsOf(await ok(await call(other, 'GET', '/courts?limit=100'), 200)).map((c) => c.id)).toEqual([other.ids.court]);
    }
  });

  it('logging in on the wrong club\'s host fails even with the right password', async (ctx) => {
    if (!available) return ctx.skip();
    const [{ email }] = await db.select({ email: users.email }).from(users).where(eq(users.id, A.ownerUserId));
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-tenant-host': B.host }, payload: { email, password: 'Password123!' } });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-tenant-host': A.host }, payload: { email, password: 'Password123!' } });
    expect(right.statusCode).toBe(200);
  });

  it('the same email can sign up in both clubs as two separate people', async (ctx) => {
    if (!available) return ctx.skip();
    const email = `twin-${RUN}@example.com`;
    const sign = (c: Club) => app.inject({ method: 'POST', url: '/api/v1/auth/signup', headers: { 'x-tenant-host': c.host }, payload: { email, password: 'Password123!', name: 'Twin' } });
    const [a, b] = [await sign(A), await sign(B)];
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().user.id).not.toBe(b.json().user.id);
    fx.userIds.push(a.json().user.id, b.json().user.id);
    expect((await sign(A)).statusCode).toBe(409);
  });

  // ---------------------------------------------------------------------------------- uploads

  it('uploads are stored under the club prefix and cannot be fetched through another club', async (ctx) => {
    if (!available || !storageUp) return ctx.skip();
    const sent = await call(A, 'POST', '/uploads/court', undefined);
    expect([400, 415]).toContain(sent.statusCode); // sanity: a body is required
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/court',
      headers: { 'x-tenant-host': A.host, cookie: A.owner.cookie, 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(res.statusCode, res.body).toBe(201);
    const out = res.json() as { url: string; key: string };
    try {
      expect(out.key.startsWith(`${A.id}/court/`)).toBe(true);
      expect(out.url).toMatch(/^\/api\/v1\/media\/court\/[0-9a-f-]+\.png$/);
      expect(await app.storage.get(out.key)).toBeTruthy();
      expect(await app.storage.get(out.url.replace('/api/v1/media/', ''))).toBeFalsy(); // never an unprefixed copy
      const own = await app.inject({ method: 'GET', url: out.url, headers: { 'x-tenant-host': A.host } });
      expect(own.statusCode).toBe(200);
      expect(own.rawPayload.equals(PNG)).toBe(true);
      const foreign = await app.inject({ method: 'GET', url: out.url, headers: { 'x-tenant-host': B.host } });
      expect(foreign.statusCode).toBe(404);
      // A path that tries to name another club's prefix is not even a valid media path.
      const sneaky = await app.inject({ method: 'GET', url: `/api/v1/media/${A.id}/court/${out.url.split('/').pop()}`, headers: { 'x-tenant-host': B.host } });
      expect([400, 404]).toContain(sneaky.statusCode);
    } finally {
      await app.storage.delete(out.key);
    }
  });

  // ---------------------------------------------------------------------------------- platform

  it('a new club starts with its own categories, branding and owner flow', async (ctx) => {
    if (!available) return ctx.skip();
    const categories = (await ok(await call(A, 'GET', '/public/product-categories', undefined, ''), 200)) as Array<{ code: string }> | { data: Array<{ code: string }> };
    const list = Array.isArray(categories) ? categories : categories.data;
    expect(list.map((c) => c.code)).toContain('RACKET');
    const site = await call(B, 'GET', '/tenant', undefined, '');
    expect(site.json().slug).toBe(`iso${RUN}-b`);
    // The platform operator sees both clubs; a club owner cannot list clubs at all.
    const directory = (await ok(await asPlatform('GET', '/platform/tenants'), 200)) as Array<{ id: string }>;
    expect(directory.map((t) => t.id)).toEqual(expect.arrayContaining([A.id, B.id]));
    expect((await call(A, 'GET', '/platform/tenants')).statusCode).toBe(403);
  });
});
