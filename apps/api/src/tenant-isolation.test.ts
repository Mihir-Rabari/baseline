import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_TENANT_ID,
  bookings,
  courtTypes,
  courts,
  getDb,
  members,
  memberships,
  notifications,
  paymentIntents,
  products,
  roles,
  runInTenant,
  runUnscoped,
  tenants,
  users,
} from '@packages/db';
import { buildApp } from './app.js';
import { JobService, expireHoldsForAllClubs, startMembershipExpiryScheduler } from './services/job.service.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { ClubFixtures, type Club } from './test-support/clubs.js';
import { createBooking, createCourt, createCourtType, createMember, createMembership, createPlan } from './test-support/court-fixtures.js';
import { tenantPrefix, uploadKey } from './lib/storage-keys.js';
import { BookingService } from './services/booking.service.js';

/**
 * Cross-club isolation (#69 piece B). Two real clubs, each created as the platform operator creates one,
 * try to read and write each other's data through the database scope, the main HTTP routes, object
 * storage and the background scheduler. Every attempt must fail as "not found" / empty, never succeed,
 * and the victim's data must be unchanged afterwards.
 */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

/** An in-memory object store, so storage isolation is tested without MinIO. */
class MemoryStorage {
  readonly objects = new Map<string, { body: Buffer; metadata?: Record<string, string> }>();
  async upload(key: string, body: Buffer | Uint8Array | string, options?: { metadata?: Record<string, string> }) {
    this.objects.set(key, { body: Buffer.from(body as Buffer), metadata: options?.metadata });
    return { key, bucket: 'memory' };
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async delete(key: string) {
    return this.objects.delete(key);
  }
  async ensureBucketExists() {}
  async healthCheck() {
    return { status: 'ok' as const };
  }
}

describe('Cross-club data isolation', () => {
  let app: FastifyInstance;
  let available = false;
  let clubs: ClubFixtures;
  let A: Club;
  let B: Club;
  const storage = new MemoryStorage();
  const db = getDb();

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    app = buildApp();
    await app.ready();
    if (!available) return;
    (app as unknown as { storage: MemoryStorage }).storage = storage;
    clubs = new ClubFixtures(app);
    A = await clubs.createClub('a');
    B = await clubs.createClub('b');
  });

  afterAll(async () => {
    if (available) await clubs.cleanup();
    await app.close();
  });

  const as = (club: Club, actor: 'owner' | 'desk' = 'owner') => club[actor];
  const call = (club: Club, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, actor?: Club['owner'], payload?: object) =>
    clubs.request(club, method, url, actor, payload);
  const ids = (res: { json: () => unknown }, key = 'id') => ((res.json() as Array<Record<string, unknown>>) ?? []).map((row) => row[key]);

  // ------------------------------------------------------------------------------------------------
  describe('database scope (row-level security)', () => {
    it('a scoped connection sees only its own club, an unscoped one (platform) sees all', async (ctx) => {
      if (!available) return ctx.skip();
      const makeCourt = (label: string) => runInTenant(label === 'a' ? A.id : B.id, async () => {
        const type = await createCourtType(db);
        return createCourt(db, type.id, `Court-${label}`);
      });
      const courtA = await makeCourt('a');
      const courtB = await makeCourt('b');
      expect(courtA.tenantId).toBe(A.id);
      expect(courtB.tenantId).toBe(B.id);

      const seenByA = await runInTenant(A.id, async () => db.select({ id: courts.id }).from(courts));
      expect(seenByA.map((r) => r.id)).toContain(courtA.id);
      expect(seenByA.map((r) => r.id)).not.toContain(courtB.id);
      const seenByB = await runInTenant(B.id, async () => db.select({ id: courts.id }).from(courts));
      expect(seenByB.map((r) => r.id)).toContain(courtB.id);
      expect(seenByB.map((r) => r.id)).not.toContain(courtA.id);
      const everything = await runUnscoped(async () => db.select({ id: courts.id }).from(courts));
      expect(everything.map((r) => r.id)).toEqual(expect.arrayContaining([courtA.id, courtB.id]));
    });

    it('club A cannot write a row for club B, nor change or delete one of B\'s rows', async (ctx) => {
      if (!available) return ctx.skip();
      const typeB = await runInTenant(B.id, async () => createCourtType(db));
      // Writing into B while scoped to A is refused by the policy's WITH CHECK.
      await expect(
        runInTenant(A.id, async () => db.insert(courtTypes).values({ tenantId: B.id, code: `X_${Date.now()}`, name: 'Smuggled', baseRatePaise: 100 }))
      ).rejects.toThrow();
      // Moving one of A's own rows into B is refused too.
      const typeA = await runInTenant(A.id, async () => createCourtType(db));
      await expect(runInTenant(A.id, async () => db.update(courtTypes).set({ tenantId: B.id }).where(eq(courtTypes.id, typeA.id)))).rejects.toThrow();
      // B's rows are simply invisible to A: updates and deletes affect nothing.
      const updated = await runInTenant(A.id, async () => db.update(courtTypes).set({ name: 'Hijacked' }).where(eq(courtTypes.id, typeB.id)).returning());
      const deleted = await runInTenant(A.id, async () => db.delete(courtTypes).where(eq(courtTypes.id, typeB.id)).returning());
      expect(updated).toHaveLength(0);
      expect(deleted).toHaveLength(0);
      const [still] = await runUnscoped(async () => db.select().from(courtTypes).where(eq(courtTypes.id, typeB.id)));
      expect(still.name).not.toBe('Hijacked');
    });

    it('holds in transactions and nested savepoints too, and a transaction rolls back cleanly', async (ctx) => {
      if (!available) return ctx.skip();
      const typeB = await runInTenant(B.id, async () => createCourtType(db));
      const result = await runInTenant(A.id, async () =>
        db.transaction(async (tx) => {
          const direct = await tx.select({ id: courtTypes.id }).from(courtTypes);
          const nested = await tx.transaction(async (inner) => inner.select({ id: courtTypes.id }).from(courtTypes));
          const who = await tx.execute(sql`select current_user as role, current_setting('app.tenant_id', true) as tenant`);
          return { direct: direct.map((r) => r.id), nested: nested.map((r) => r.id), who: (who as unknown as Array<{ role: string; tenant: string }>)[0] };
        })
      );
      expect(result.direct).not.toContain(typeB.id);
      expect(result.nested).not.toContain(typeB.id);
      expect(result.who).toEqual({ role: 'baseline_tenant', tenant: A.id });
      // A failing transaction leaves nothing behind.
      const code = `RB_${randomUUID().slice(0, 8)}`.toUpperCase();
      await expect(
        runInTenant(A.id, async () =>
          db.transaction(async (tx) => {
            await tx.insert(courtTypes).values({ code, name: 'Rolled back', baseRatePaise: 100, socialFeePaise: 0, trialFeePaise: 0, socialCapacity: 0 });
            throw new Error('boom');
          })
        )
      ).rejects.toThrow('boom');
      expect(await runUnscoped(async () => db.select().from(courtTypes).where(eq(courtTypes.code, code)))).toHaveLength(0);
    });

    it('no pooled connection keeps a club between statements (nothing leaks to the next caller)', async (ctx) => {
      if (!available) return ctx.skip();
      const probe = async (scoped: Club | null) => {
        const run = async () => {
          const rows = await db.execute(sql`select current_user as role, coalesce(current_setting('app.tenant_id', true), '') as tenant`);
          return (rows as unknown as Array<{ role: string; tenant: string }>)[0];
        };
        return scoped ? runInTenant(scoped.id, run) : run();
      };
      // Interleave scoped and unscoped statements well beyond the pool size so connections are reused.
      const work = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? probe(A) : i % 3 === 1 ? probe(B) : probe(null)));
      const out = await Promise.all(work);
      out.forEach((row, i) => {
        if (i % 3 === 2) {
          expect(row.role).not.toBe('baseline_tenant');
          expect(row.tenant).toBe('');
        } else {
          expect(row).toEqual({ role: 'baseline_tenant', tenant: i % 3 === 0 ? A.id : B.id });
        }
      });
    });

    it('a club role with no tenant selected sees nothing (fail closed)', async (ctx) => {
      if (!available) return ctx.skip();
      await runInTenant(A.id, async () => createCourtType(db));
      const count = await runUnscoped(async () =>
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role baseline_tenant`);
          const rows = await tx.execute(sql`select count(*)::int as n from court_types`);
          return (rows as unknown as Array<{ n: number }>)[0].n;
        })
      );
      expect(count).toBe(0);
    });

    it('rejects malformed tenant ids instead of building a scope from them', () => {
      expect(() => runInTenant("x'; drop table users; --", () => 1)).toThrow('Invalid tenant id');
      expect(() => runInTenant('', () => 1)).toThrow('Invalid tenant id');
    });

    it('every table carries tenant_id with an enforced policy, except the shared permission catalogue', async (ctx) => {
      if (!available) return ctx.skip();
      const rows = (await runUnscoped(async () =>
        db.execute(sql`
          select c.relname as table_name,
                 c.relrowsecurity as rls,
                 exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant_id,
                 exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'tenant_isolation') as has_policy
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`)
      )) as unknown as Array<{ table_name: string; rls: boolean; has_tenant_id: boolean; has_policy: boolean }>;
      const shared = new Set(['permissions']);
      const offenders = rows.filter((r) => !shared.has(r.table_name) && r.table_name !== 'tenants' && !(r.rls && r.has_policy && r.has_tenant_id)).map((r) => r.table_name);
      // A new table must be added to the isolation policy (migration 0017 shows how) or listed as shared.
      expect(offenders).toEqual([]);
      expect(rows.find((r) => r.table_name === 'tenants')).toMatchObject({ rls: true, has_policy: true });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('sessions', () => {
    it('a session of club A is no session at all on club B, even once it is cached', async (ctx) => {
      if (!available) return ctx.skip();
      // Warm the cache for A's owner on A's address.
      expect((await call(A, 'GET', '/auth/session', A.owner)).statusCode).toBe(200);
      expect((await call(A, 'GET', '/iam/users', A.owner)).statusCode).toBe(200);
      // The same cookie on B's address is anonymous, not merely unauthorized for some routes.
      expect((await call(B, 'GET', '/auth/session', A.owner)).statusCode).toBe(401);
      expect((await call(B, 'GET', '/iam/users', A.owner)).statusCode).toBe(401);
      expect((await call(B, 'GET', '/courts', A.owner)).statusCode).toBe(401);
      expect((await call(B, 'PUT', '/tenant/branding', A.owner, { primaryColor: '#123456' })).statusCode).toBe(401);
    });

    it('logging in with club A\'s credentials on club B fails', async (ctx) => {
      if (!available) return ctx.skip();
      const [{ email }] = await runInTenant(A.id, async () => db.select({ email: users.email }).from(users).where(eq(users.id, A.owner.id)));
      const onA = await clubs.request(A, 'POST', '/auth/login', undefined, { email, password: 'Password123!' });
      expect(onA.statusCode).toBe(200);
      const onB = await clubs.request(B, 'POST', '/auth/login', undefined, { email, password: 'Password123!' });
      expect(onB.statusCode).toBe(401);
    });

    it('the same email can belong to two clubs without either seeing the other', async (ctx) => {
      if (!available) return ctx.skip();
      const email = `shared-${randomUUID()}@example.com`;
      for (const club of [A, B]) {
        const res = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', remoteAddress: `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, headers: clubs.headers(club), payload: { email, password: 'Password123!', name: 'Twin' } });
        expect(res.statusCode, res.body).toBe(201);
      }
      const rowsA = await runInTenant(A.id, async () => db.select({ id: users.id }).from(users).where(eq(users.email, email)));
      const rowsB = await runInTenant(B.id, async () => db.select({ id: users.id }).from(users).where(eq(users.email, email)));
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);
      expect(rowsA[0].id).not.toBe(rowsB[0].id);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('courts and court types', () => {
    it('B cannot list, read, change or delete A\'s courts; both clubs can use the same names', async (ctx) => {
      if (!available) return ctx.skip();
      const code = `PADEL_${randomUUID().slice(0, 6).toUpperCase()}`;
      const type = await call(A, 'POST', '/court-types', as(A), { code, name: 'Padel', baseRatePaise: 80000 });
      expect(type.statusCode, type.body).toBe(201);
      const court = await call(A, 'POST', '/courts', as(A), { name: 'Court One', courtTypeId: type.json().id });
      expect(court.statusCode, court.body).toBe(201);

      // B sees none of it.
      expect(ids(await call(B, 'GET', '/court-types', as(B)))).not.toContain(type.json().id);
      expect(ids(await call(B, 'GET', '/courts', as(B)))).not.toContain(court.json().id);
      // ...and cannot touch it by id: 404, never 200/403.
      expect((await call(B, 'PUT', `/court-types/${type.json().id}`, as(B), { name: 'Hijacked' })).statusCode).toBe(404);
      expect((await call(B, 'PUT', `/courts/${court.json().id}`, as(B), { name: 'Hijacked' })).statusCode).toBe(404);
      expect((await call(B, 'DELETE', `/courts/${court.json().id}`, as(B))).statusCode).toBe(404);
      // B cannot put its court on A's court type.
      expect((await call(B, 'POST', '/courts', as(B), { name: 'Cross', courtTypeId: type.json().id })).statusCode).toBeGreaterThanOrEqual(400);
      // A's data is unchanged.
      const list = (await call(A, 'GET', '/courts', as(A))).json() as Array<{ id: string; name: string }>;
      expect(list.find((c) => c.id === court.json().id)?.name).toBe('Court One');

      // Names are unique per club, not globally: B may reuse A's code and court name.
      const typeB = await call(B, 'POST', '/court-types', as(B), { code, name: 'Padel', baseRatePaise: 70000 });
      expect(typeB.statusCode, typeB.body).toBe(201);
      expect((await call(B, 'POST', '/courts', as(B), { name: 'Court One', courtTypeId: typeB.json().id })).statusCode).toBe(201);
      // Inside one club a duplicate is still refused.
      expect((await call(A, 'POST', '/court-types', as(A), { code, name: 'Again', baseRatePaise: 1000 })).statusCode).toBe(409);
    });

    it('public (signed-out) pages of one club never show another club\'s data', async (ctx) => {
      if (!available) return ctx.skip();
      const plan = await runInTenant(A.id, async () => createPlan(db, { code: `ONLYA_${randomUUID().slice(0, 6)}` }));
      const publicOfB = await call(B, 'GET', '/public/plans');
      expect(publicOfB.statusCode).toBe(200);
      expect(JSON.stringify(publicOfB.json())).not.toContain(plan.code);
      const publicOfA = await call(A, 'GET', '/public/plans');
      expect(JSON.stringify(publicOfA.json())).toContain(plan.code);
      const club = (await call(B, 'GET', '/public/club')).json();
      expect(JSON.stringify(club)).not.toContain('Club a');
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('products, categories and shop', () => {
    it('B cannot see or change A\'s products, and categories are per club', async (ctx) => {
      if (!available) return ctx.skip();
      const sku = `ISO-${randomUUID().slice(0, 8)}`;
      const created = await call(A, 'POST', '/products', as(A), { sku, name: 'Grip tape', category: 'ACCESSORY', pricePaise: 12000, stockQty: 10 });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id as string;

      const listB = (await call(B, 'GET', '/products', as(B))).json() as { data?: Array<{ id: string }> } | Array<{ id: string }>;
      expect(JSON.stringify(listB)).not.toContain(id);
      expect(JSON.stringify((await call(B, 'GET', '/public/products')).json())).not.toContain(id);
      expect((await call(B, 'GET', `/products/${id}`, as(B))).statusCode).toBe(404);
      expect((await call(B, 'PUT', `/products/${id}`, as(B), { name: 'Hijacked' })).statusCode).toBe(404);
      expect((await call(B, 'DELETE', `/products/${id}`, as(B))).statusCode).toBe(404);
      expect((await call(B, 'POST', `/products/${id}/restock`, as(B), { qty: 500 })).statusCode).toBe(404);
      expect((await call(B, 'POST', `/products/${id}/adjust`, as(B), { delta: -5, reason: 'x' })).statusCode).toBeGreaterThanOrEqual(400);
      const [row] = await runInTenant(A.id, async () => db.select().from(products).where(eq(products.id, id)));
      expect(row).toMatchObject({ name: 'Grip tape', stockQty: 10, isActive: true });

      // The same SKU is fine in the other club.
      expect((await call(B, 'POST', '/products', as(B), { sku, name: 'Grip tape', category: 'ACCESSORY', pricePaise: 9000, stockQty: 3 })).statusCode).toBe(201);

      // A category created by A does not exist for B.
      const code = `PAD${randomUUID().slice(0, 4).toUpperCase()}`.replace(/[^A-Z0-9]/g, 'X');
      const cat = await call(A, 'POST', '/products/categories', as(A), { code, name: 'Padel gear' });
      expect(cat.statusCode, cat.body).toBe(201);
      const withA = await call(A, 'POST', '/products', as(A), { sku: `${sku}-c`, name: 'Padel racket', category: code, pricePaise: 100, stockQty: 1 });
      expect(withA.statusCode, withA.body).toBe(201);
      const withB = await call(B, 'POST', '/products', as(B), { sku: `${sku}-c`, name: 'Padel racket', category: code, pricePaise: 100, stockQty: 1 });
      expect([400, 422]).toContain(withB.statusCode);
      expect(JSON.stringify((await call(B, 'GET', '/products/categories', as(B))).json())).not.toContain(code);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('members, memberships and bookings', () => {
    it('B cannot find, read, change or check in A\'s member', async (ctx) => {
      if (!available) return ctx.skip();
      const plan = await runInTenant(A.id, async () => createPlan(db));
      const reg = await call(A, 'POST', '/members', as(A, 'desk'), { fullName: 'Alice Isolated', phone: `+91${Math.floor(Math.random() * 9e9 + 1e9)}`, planId: plan.id, paymentMethod: 'CASH' });
      expect(reg.statusCode, reg.body).toBe(201);
      const memberId = (reg.json().member?.id ?? reg.json().id) as string;

      const list = await call(B, 'GET', '/members?limit=100', as(B, 'desk'));
      expect(list.statusCode).toBe(200);
      expect(JSON.stringify(list.json())).not.toContain(memberId);
      expect(JSON.stringify((await call(B, 'GET', '/members/lookup?q=Alice', as(B, 'desk'))).json())).not.toContain(memberId);
      expect((await call(B, 'GET', `/members/${memberId}`, as(B, 'desk'))).statusCode).toBe(404);
      expect((await call(B, 'PUT', `/members/${memberId}`, as(B), { fullName: 'Hijacked' })).statusCode).toBe(404);
      expect((await call(B, 'GET', `/members/${memberId}/timeline`, as(B, 'desk'))).statusCode).toBe(404);
      expect((await call(B, 'POST', `/members/${memberId}/checkin`, as(B, 'desk'), {})).statusCode).toBe(404);
      expect((await call(B, 'POST', `/members/${memberId}/membership/renew`, as(B, 'desk'), { paymentMethod: 'CASH' })).statusCode).toBe(404);
      const [row] = await runInTenant(A.id, async () => db.select().from(members).where(eq(members.id, memberId)));
      expect(row.fullName).toBe('Alice Isolated');
    });

    it('bookings of one club are invisible to the other, and cannot be cancelled or paid by it', async (ctx) => {
      if (!available) return ctx.skip();
      const booking = await runInTenant(A.id, async () => {
        const type = await createCourtType(db);
        const court = await createCourt(db, type.id, 'Booked');
        return createBooking(db, { courtId: court.id, startsAt: new Date(Date.now() + 3 * 86_400_000), bookingDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), withOccupancy: false });
      });
      expect(JSON.stringify((await call(B, 'GET', '/bookings?limit=100', as(B, 'desk'))).json())).not.toContain(booking.id);
      expect((await call(B, 'GET', `/bookings/${booking.id}`, as(B, 'desk'))).statusCode).toBe(404);
      expect((await call(B, 'POST', `/bookings/${booking.id}/cancel`, as(B, 'desk'), {})).statusCode).toBe(404);
      expect((await call(B, 'POST', `/bookings/${booking.id}/pay`, as(B, 'desk'), { method: 'CASH' })).statusCode).toBe(404);
      expect((await call(B, 'POST', `/bookings/${booking.id}/no-show`, as(B, 'desk'), {})).statusCode).toBe(404);
      expect((await call(B, 'POST', `/bookings/${booking.id}/complete`, as(B, 'desk'), {})).statusCode).toBe(404);
      const [row] = await runInTenant(A.id, async () => db.select().from(bookings).where(eq(bookings.id, booking.id)));
      expect(row.status).toBe('CONFIRMED');
      // A can still see its own booking.
      expect((await call(A, 'GET', `/bookings/${booking.id}`, as(A, 'desk'))).statusCode).toBe(200);
    });

    it('B cannot book A\'s court', async (ctx) => {
      if (!available) return ctx.skip();
      const court = await runInTenant(A.id, async () => createCourt(db, (await createCourtType(db)).id, 'NotForB'));
      const res = await call(B, 'POST', '/bookings', as(B, 'desk'), { courtId: court.id, startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), guest: { name: 'Mallory', phone: '+919800000001' } });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('CRM, bar and IAM', () => {
    it('B cannot read or change A\'s leads, and its summary excludes them', async (ctx) => {
      if (!available) return ctx.skip();
      const lead = await call(A, 'POST', '/crm/leads', as(A, 'desk'), { name: 'Prospect Isolated', phone: `+91${Math.floor(Math.random() * 9e9 + 1e9)}`, source: 'WALK_IN' });
      expect(lead.statusCode, lead.body).toBe(201);
      const id = lead.json().id as string;
      expect(JSON.stringify((await call(B, 'GET', '/crm/leads?limit=100', as(B, 'desk'))).json())).not.toContain(id);
      expect((await call(B, 'GET', `/crm/leads/${id}`, as(B, 'desk'))).statusCode).toBe(404);
      expect((await call(B, 'PATCH', `/crm/leads/${id}`, as(B, 'desk'), { status: 'LOST', lostReason: 'x' })).statusCode).toBe(404);
      expect((await call(B, 'POST', `/crm/leads/${id}/activities`, as(B, 'desk'), { type: 'NOTE', body: 'spam' })).statusCode).toBe(404);
      const summaryB = (await call(B, 'GET', '/crm/summary', as(B, 'desk'))).json();
      expect(JSON.stringify(summaryB)).not.toContain('Prospect Isolated');
      expect((await call(A, 'GET', `/crm/leads/${id}`, as(A, 'desk'))).json().lead.status).toBe('NEW');
    });

    it('B cannot see or change A\'s bar tables', async (ctx) => {
      if (!available) return ctx.skip();
      const name = `Tbl-${randomUUID().slice(0, 5)}`;
      const table = await call(A, 'POST', '/bar/tables', as(A), { name, seats: 4 });
      expect(table.statusCode, table.body).toBe(201);
      expect(JSON.stringify((await call(B, 'GET', '/bar/tables', as(B))).json())).not.toContain(table.json().id);
      expect((await call(B, 'PUT', `/bar/tables/${table.json().id}`, as(B), { seats: 6 })).statusCode).toBe(404);
      expect((await call(B, 'DELETE', `/bar/tables/${table.json().id}`, as(B))).statusCode).toBe(404);
      // The same table name is free in the other club.
      expect((await call(B, 'POST', '/bar/tables', as(B), { name, seats: 2 })).statusCode).toBe(201);
    });

    it('B\'s owner cannot list, read or alter A\'s users, roles or permissions', async (ctx) => {
      if (!available) return ctx.skip();
      const users = await call(B, 'GET', '/iam/users?limit=100', as(B));
      expect(users.statusCode).toBe(200);
      const body = JSON.stringify(users.json());
      for (const foreign of [A.owner.id, A.desk.id]) expect(body).not.toContain(foreign);
      for (const foreign of [A.owner.id, A.desk.id]) {
        for (const res of [
          await call(B, 'GET', `/iam/users/${foreign}`, as(B)),
          await call(B, 'PATCH', `/iam/users/${foreign}/status`, as(B), { status: 'SUSPENDED' }),
          await call(B, 'GET', `/iam/users/${foreign}/permissions`, as(B)),
        ]) {
          expect([403, 404], res.body).toContain(res.statusCode);
        }
      }
      // A's owner is still active.
      const [owner] = await runInTenant(A.id, async () => db.select({ status: users_.status }).from(users_).where(eq(users_.id, A.owner.id)));
      expect(owner.status).toBe('ACTIVE');

      // B cannot hand its own user one of A's roles.
      const roleA = await runInTenant(A.id, async () => db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'OWNER')));
      const assign = await call(B, 'POST', `/iam/users/${B.desk.id}/roles`, as(B), { roleId: roleA[0].id });
      expect(assign.statusCode).toBeGreaterThanOrEqual(400);
      expect(assign.statusCode).toBeLessThan(500);
      const deskRoles = await call(B, 'GET', `/iam/users/${B.desk.id}/permissions`, as(B));
      expect(JSON.stringify(deskRoles.json())).not.toContain('admin:access');

      // Roles are per club: a custom role of A is unknown to B, and B may reuse its name.
      const name = `Custom-${randomUUID().slice(0, 6)}`;
      const [role] = await runInTenant(A.id, async () => db.insert(roles).values({ name, description: 'only in A' }).returning());
      const rolesOf = (club: Club) => runInTenant(club.id, async () => db.select({ id: roles.id }).from(roles));
      expect((await rolesOf(A)).map((r) => r.id)).toContain(role.id);
      expect((await rolesOf(B)).map((r) => r.id)).not.toContain(role.id);
      await expect(runInTenant(B.id, async () => db.insert(roles).values({ name }).returning())).resolves.toHaveLength(1);
      // ...but inside one club the name stays unique.
      await expect(runInTenant(A.id, async () => db.insert(roles).values({ name }))).rejects.toThrow();
    });

    it('notifications are per club', async (ctx) => {
      if (!available) return ctx.skip();
      await runInTenant(A.id, async () => db.insert(notifications).values({ userId: A.desk.id, type: 'MEMBERSHIP_EXPIRING', title: 'Only for A', body: 'x' }));
      const mine = await call(A, 'GET', '/notifications', as(A, 'desk'));
      expect(JSON.stringify(mine.json())).toContain('Only for A');
      const theirs = await call(B, 'GET', '/notifications', as(B, 'desk'));
      expect(JSON.stringify(theirs.json())).not.toContain('Only for A');
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('object storage', () => {
    const upload = (club: Club, kind: string) =>
      app.inject({ method: 'POST', url: `/api/v1/uploads/${kind}`, headers: { ...clubs.headers(club, as(club)), 'content-type': 'image/png' }, payload: PNG });

    it('stores every upload under the club\'s own prefix and serves it only on that club\'s address', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await upload(A, 'product');
      expect(a.statusCode, a.body).toBe(201);
      expect(a.json().key.startsWith(tenantPrefix(A.id))).toBe(true);
      expect(storage.objects.get(a.json().key)?.metadata?.tenant).toBe(A.id);

      // A's own address serves it; B's address does not know it, even with the exact same URL.
      const servedA = await clubs.request(A, 'GET', a.json().url);
      expect(servedA.statusCode).toBe(200);
      expect(Buffer.compare(servedA.rawPayload, PNG)).toBe(0);
      expect((await clubs.request(B, 'GET', a.json().url)).statusCode).toBe(404);

      // B's own upload cannot collide with or replace A's object, and is invisible to A.
      const b = await upload(B, 'product');
      expect(b.statusCode).toBe(201);
      expect(b.json().key.startsWith(tenantPrefix(B.id))).toBe(true);
      expect(b.json().key).not.toBe(a.json().key);
      expect((await clubs.request(A, 'GET', b.json().url)).statusCode).toBe(404);
      expect(storage.objects.get(a.json().key)?.body.equals(PNG)).toBe(true);
    });

    it('a caller cannot choose the prefix: traversal, foreign prefixes and other clubs\' ids are refused', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await upload(A, 'court');
      const file = (a.json().url as string).split('/').pop();
      const attempts = [
        `/api/v1/media/tenants/${A.id}/court/${file}`,
        `/api/v1/media/court/..%2F..%2Ftenants%2F${A.id}%2Fcourt%2F${file}`,
        `/api/v1/media/%2e%2e/${file}`,
        `/api/v1/media/court/${file}%00.png`,
      ];
      for (const url of attempts) {
        const res = await clubs.request(B, 'GET', url);
        expect([400, 404], url).toContain(res.statusCode);
        expect(res.rawPayload.equals(PNG), url).toBe(false);
      }
      // The id in the key is the request's club; nothing in the body or query can override it.
      const spoof = await app.inject({ method: 'POST', url: `/api/v1/uploads/court?tenantId=${A.id}`, headers: { ...clubs.headers(B, as(B)), 'content-type': 'image/png', 'x-tenant-id': A.id }, payload: PNG });
      expect(spoof.statusCode).toBe(201);
      expect(spoof.json().key.startsWith(tenantPrefix(B.id))).toBe(true);
    });

    it('objects stored before per-club prefixes belong to the default club only', async (ctx) => {
      if (!available) return ctx.skip();
      const file = `${randomUUID()}.png`;
      const legacy = Buffer.concat([PNG, Buffer.from('legacy')]);
      await storage.upload(`product/${file}`, legacy);
      expect((await app.inject({ method: 'GET', url: `/api/v1/media/product/${file}` })).rawPayload.equals(legacy)).toBe(true);
      expect((await clubs.request(A, 'GET', `/api/v1/media/product/${file}`)).statusCode).toBe(404);
      expect((await clubs.request(B, 'GET', `/api/v1/media/product/${file}`)).statusCode).toBe(404);
      // A new upload to the default club goes under its prefix, not the legacy location.
      expect(uploadKey(DEFAULT_TENANT_ID, 'product', file).startsWith(`tenants/${DEFAULT_TENANT_ID}/`)).toBe(true);
    });

    it('profile photos are stored per club and not readable across clubs', async (ctx) => {
      if (!available) return ctx.skip();
      // The route accepts a static PNG; a 1x1 RGBA image is enough.
      const { deflateSync } = await import('node:zlib');
      const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
      const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc(body), out.length - 4); return out; };
      const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
      const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 10, 20, 30, 255]))), chunk('IEND', Buffer.alloc(0))]);
      const put = await call(A, 'PUT', '/profile/avatar', A.desk, { imageBase64: png.toString('base64') });
      expect(put.statusCode, put.body).toBe(200);
      const keys = [...storage.objects.keys()].filter((k) => k.endsWith(`profiles/${A.desk.id}/avatar.png`));
      expect(keys).toEqual([`${tenantPrefix(A.id)}profiles/${A.desk.id}/avatar.png`]);
      // B's owner (not even ROOT) cannot read A's user's photo; and A's cookie is anonymous on B.
      expect((await call(B, 'GET', `/profile/avatar/${A.desk.id}`, as(B))).statusCode).toBe(403);
      expect((await call(B, 'GET', `/profile/avatar/${A.desk.id}`, A.desk)).statusCode).toBe(401);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('payment hold expiry', () => {
    async function seedHold(club: Club) {
      return runInTenant(club.id, async () => {
        const type = await createCourtType(db);
        const court = await createCourt(db, type.id);
        const at = new Date(Date.now() + 86_400_000);
        const [intent] = await db.insert(paymentIntents).values({
          method: 'UPI', amountPaise: 1000, totalPaise: 1000, basePricePaise: 1000, courtId: court.id,
          startsAt: at, endsAt: new Date(at.getTime() + 3_600_000), guestName: 'Guest', guestPhone: '9999999999',
          expiresAt: new Date(Date.now() - 60_000),
        }).returning();
        return intent;
      });
    }
    const statusOf = (club: Club, id: string) =>
      runInTenant(club.id, async () => (await db.select().from(paymentIntents).where(eq(paymentIntents.id, id)))[0]?.status);

    it('releasing holds inside one club leaves the other club\'s expired hold untouched', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await seedHold(A);
      const b = await seedHold(B);
      const released = await runInTenant(A.id, async () => new BookingService(db, { timezone: 'Asia/Kolkata' }).expireHolds());
      expect(released).toBeGreaterThanOrEqual(1);
      expect(await statusOf(A, a.id)).toBe('EXPIRED');
      expect(await statusOf(B, b.id)).toBe('PENDING');
      // A club can never see the other club's hold at all.
      expect(await runInTenant(A.id, async () => db.select().from(paymentIntents).where(eq(paymentIntents.id, b.id)))).toHaveLength(0);
    });

    it('the all-clubs sweep releases each club\'s holds under that club\'s own scope', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await seedHold(A);
      const b = await seedHold(B);
      const released = await expireHoldsForAllClubs(db, () => new BookingService(db, { timezone: 'Asia/Kolkata' }).expireHolds());
      expect(released).toBeGreaterThanOrEqual(2);
      expect(await statusOf(A, a.id)).toBe('EXPIRED');
      expect(await statusOf(B, b.id)).toBe('EXPIRED');
    });
  });

  describe('background scheduler', () => {
    async function seedExpiring(club: Club, label: string) {
      return runInTenant(club.id, async () => {
        const plan = await createPlan(db);
        const member = await createMember(db, { fullName: `Expiry ${label}` });
        const membership = await createMembership(db, { memberId: member.id, planId: plan.id, startsOn: '2019-01-01', endsOn: '2019-12-31' });
        return { member, membership };
      });
    }

    it('runs once per active club, each under its own scope, and never crosses clubs', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await seedExpiring(A, 'A');
      const b = await seedExpiring(B, 'B');
      const jobs = new JobService(db);
      const result = await jobs.runMembershipExpiryForAllClubs('2020-06-01');
      expect(result.failed).toBe(0);
      expect(result.perClub.map((c) => c.tenantId)).toEqual(expect.arrayContaining([A.id, B.id]));
      expect(result.perClub.every((c) => !c.error)).toBe(true);

      for (const [club, seeded] of [[A, a], [B, b]] as const) {
        const [m] = await runInTenant(club.id, async () => db.select().from(memberships).where(eq(memberships.id, seeded.membership.id)));
        expect(m.status).toBe('EXPIRED');
        // Notifications raised for a club's front desk exist in that club, and only there.
        const own = await runInTenant(club.id, async () => db.select().from(notifications).where(eq(notifications.userId, club.desk.id)));
        expect(own.some((n) => n.dedupeKey?.includes(seeded.membership.id))).toBe(true);
        expect(own.every((n) => n.tenantId === club.id)).toBe(true);
        const other = club === A ? B : A;
        const foreign = await runInTenant(other.id, async () => db.select().from(notifications));
        expect(foreign.some((n) => n.dedupeKey?.includes(seeded.membership.id))).toBe(false);
      }
    });

    it('running the job inside one club leaves the other club\'s memberships untouched', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await seedExpiring(A, 'A2');
      const b = await seedExpiring(B, 'B2');
      const jobs = new JobService(db);
      const result = await runInTenant(A.id, async () => jobs.runMembershipExpiry('2020-06-01'));
      expect(result.expired).toBeGreaterThanOrEqual(1);
      const [mA] = await runInTenant(A.id, async () => db.select().from(memberships).where(eq(memberships.id, a.membership.id)));
      const [mB] = await runInTenant(B.id, async () => db.select().from(memberships).where(eq(memberships.id, b.membership.id)));
      expect(mA.status).toBe('EXPIRED');
      expect(mB.status).toBe('ACTIVE');
    });

    it('skips suspended clubs and keeps going when one club fails', async (ctx) => {
      if (!available) return ctx.skip();
      await seedExpiring(A, 'A3');
      const b = await seedExpiring(B, 'B3');
      const jobs = new JobService(db);
      await runUnscoped(async () => db.update(tenants).set({ status: 'SUSPENDED' }).where(eq(tenants.id, B.id)));
      try {
        const skipped = await jobs.runMembershipExpiryForAllClubs('2020-06-02');
        expect(skipped.perClub.map((c) => c.tenantId)).not.toContain(B.id);
        const [mB] = await runInTenant(B.id, async () => db.select().from(memberships).where(eq(memberships.id, b.membership.id)));
        expect(mB.status).toBe('ACTIVE');
      } finally {
        await runUnscoped(async () => db.update(tenants).set({ status: 'ACTIVE' }).where(eq(tenants.id, B.id)));
      }

      const real = JobService.prototype.runMembershipExpiry;
      const failFor = A.id;
      const patched = vi.spyOn(JobService.prototype, 'runMembershipExpiry').mockImplementation(async function (this: JobService, asOf?: string) {
        const { currentTenantScope } = await import('@packages/db');
        if (currentTenantScope() === failFor) throw new Error('club A is broken');
        return real.call(this, asOf);
      });
      try {
        const result = await jobs.runMembershipExpiryForAllClubs('2020-06-03');
        expect(result.failed).toBeGreaterThanOrEqual(1);
        expect(result.perClub.find((c) => c.tenantId === A.id)?.error).toBe('club A is broken');
        expect(result.perClub.find((c) => c.tenantId === B.id)?.error).toBeUndefined();
        const [mB] = await runInTenant(B.id, async () => db.select().from(memberships).where(eq(memberships.id, b.membership.id)));
        expect(mB.status).toBe('EXPIRED');
      } finally {
        patched.mockRestore();
      }
    });

    it('the timer sweeps every club on each tick', async () => {
      vi.useFakeTimers();
      try {
        const sweep = vi.fn().mockResolvedValue({ clubs: 2, failed: 1, expired: 3, remindersCreated: 4, perClub: [{ tenantId: 'x', slug: 'x', error: 'boom' }] });
        const log = { info: vi.fn(), error: vi.fn() };
        const stop = startMembershipExpiryScheduler({ runMembershipExpiryForAllClubs: sweep } as unknown as JobService, log, 1000);
        await vi.advanceTimersByTimeAsync(2100);
        stop();
        expect(sweep).toHaveBeenCalledTimes(2);
        expect(log.info).toHaveBeenCalledWith({ clubs: 2, failed: 1, expired: 3, remindersCreated: 4 }, 'Membership expiry job completed');
        expect(log.error).toHaveBeenCalledWith({ tenantId: 'x', slug: 'x', error: 'boom' }, 'Membership expiry job failed for a club');
      } finally {
        vi.useRealTimers();
      }
    });

    it('the manual trigger only ever runs for the caller\'s club', async (ctx) => {
      if (!available) return ctx.skip();
      const a = await seedExpiring(A, 'A4');
      const b = await seedExpiring(B, 'B4');
      const res = await call(A, 'POST', '/admin/jobs/membership-expiry', as(A), { asOf: '2020-06-04' });
      expect(res.statusCode, res.body).toBe(200);
      const [mA] = await runInTenant(A.id, async () => db.select().from(memberships).where(eq(memberships.id, a.membership.id)));
      const [mB] = await runInTenant(B.id, async () => db.select().from(memberships).where(eq(memberships.id, b.membership.id)));
      expect(mA.status).toBe('EXPIRED');
      expect(mB.status).toBe('ACTIVE');
    });
  });
});

// `users` is also a local name in a test above; keep the table import distinct.
import { users as users_ } from '@packages/db';
