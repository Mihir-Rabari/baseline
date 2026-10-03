import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { invoices, members, membershipEvents, memberships, payments, plans, users } from '@packages/db';
import { CreateMemberResponseSchema, MemberSchema } from '@packages/validation';
import { hashSessionToken } from '@packages/auth';
import { buildApp } from './app.js';
import { addDays, clubDateOf } from './lib/club-date.js';
import { InvoiceService } from './services/invoice.service.js';
import { MembershipService, deriveExpiry } from './services/membership.service.js';
import type { PaymentService } from './services/payment.service.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const TZ = 'Asia/Kolkata';
const today = () => clubDateOf(new Date(), TZ);

describe('Members, plans and memberships (M-10)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  const db = fx.db;
  let desk: Actor;
  let owner: Actor;
  let bar: Actor;
  let memberUser: Actor;

  const as = (actor: Actor) => ({ cookie: actor.cookie });

  async function register(
    planId: string,
    extra: Record<string, unknown> = {},
    actor: Actor = desk
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/members',
      headers: as(actor),
      payload: {
        fullName: 'M10 Test Member',
        phone: MembersFixtures.phone(),
        planId,
        paymentMethod: 'UPI',
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (hasDatabase) {
      desk = await fx.actor(app, 'FRONT_DESK');
      owner = await fx.actor(app, 'OWNER');
      bar = await fx.actor(app, 'BAR_STAFF');
      memberUser = await fx.actor(app, 'MEMBER');
    }
  });

  afterAll(async () => {
    if (hasDatabase) await fx.cleanup();
    await app.close();
  });

  describe('pure helpers', () => {
    it('derives daysLeft and expiryState from ends_on and the club date', () => {
      expect(deriveExpiry('ACTIVE', '2026-10-20', '2026-10-03')).toEqual({ daysLeft: 17, expiryState: 'OK' });
      expect(deriveExpiry('ACTIVE', '2026-10-10', '2026-10-03')).toEqual({ daysLeft: 7, expiryState: 'EXPIRING_SOON' });
      expect(deriveExpiry('ACTIVE', '2026-10-03', '2026-10-03')).toEqual({ daysLeft: 0, expiryState: 'EXPIRING_SOON' });
      expect(deriveExpiry('ACTIVE', '2026-10-02', '2026-10-03')).toEqual({ daysLeft: 0, expiryState: 'EXPIRED' });
      expect(deriveExpiry('EXPIRED', '2026-12-01', '2026-10-03').expiryState).toBe('EXPIRED');
    });

    it('computes the club date in the club zone, not UTC', () => {
      // 20:00 UTC on the 3rd is already 01:30 on the 4th in Kolkata.
      expect(clubDateOf(new Date('2026-10-03T20:00:00Z'), TZ)).toBe('2026-10-04');
      expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    });

    it('takes the tax as the inclusive portion of the total', () => {
      expect(InvoiceService.taxPortion(150000, 1800)).toBe(22881);
    });
  });

  describe('routes: authentication (401) and validation (400)', () => {
    const id = randomUUID();
    // Bodies are valid on purpose: schema validation runs before the auth hook.
    it.each([
      ['GET', '/api/v1/plans'],
      ['PUT', `/api/v1/plans/${id}`, { name: 'x' }],
      ['GET', '/api/v1/members'],
      ['GET', '/api/v1/members/lookup?q=ab'],
      ['POST', '/api/v1/members', { fullName: 'A', phone: '+919800000000', planId: id, paymentMethod: 'UPI' }],
      ['GET', `/api/v1/members/${id}`],
      ['GET', `/api/v1/members/${id}/timeline`],
      ['POST', `/api/v1/members/${id}/checkin`, {}],
      ['POST', `/api/v1/members/${id}/membership/renew`, { paymentMethod: 'CASH' }],
      ['GET', '/api/v1/me/member'],
      ['PUT', '/api/v1/me/member', { fullName: 'A', phone: '+919800000000' }],
      ['POST', '/api/v1/admin/jobs/membership-expiry', {}],
    ] as const)('%s %s returns 401 without a session', async (method, url, payload) => {
      const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid input with 400 VALIDATION_ERROR', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const planId = randomUUID();
      const cases: Array<[string, string, unknown, Actor]> = [
        ['POST', '/api/v1/members', { fullName: '', phone: 'abc', planId: 'nope', paymentMethod: 'BITCOIN' }, desk],
        ['POST', '/api/v1/members', { fullName: 'A', phone: '+919800000000', planId, paymentMethod: 'UPI', dateOfBirth: '2020-02-30' }, desk],
        ['GET', '/api/v1/members?page=0', undefined, desk],
        ['GET', '/api/v1/members?status=WHATEVER', undefined, desk],
        ['GET', '/api/v1/members/lookup?q=a', undefined, desk],
        ['GET', '/api/v1/members/lookup?q=ab&limit=500', undefined, bar],
        ['GET', '/api/v1/members/not-a-uuid', undefined, desk],
        ['GET', '/api/v1/members/not-a-uuid/timeline', undefined, desk],
        ['POST', `/api/v1/members/${planId}/checkin`, { bookingId: 'nope' }, desk],
        ['POST', `/api/v1/members/${planId}/membership/renew`, { paymentMethod: 'CHEQUE' }, desk],
        ['PUT', `/api/v1/plans/${planId}`, { courtDiscountPct: 101 }, owner],
        ['PUT', `/api/v1/plans/${planId}`, { monthlyFeePaise: -5 }, owner],
        ['PUT', '/api/v1/me/member', { fullName: '', phone: '1' }, memberUser],
        ['POST', '/api/v1/admin/jobs/membership-expiry', { asOf: '2026-13-45' }, owner],
      ];
      for (const [method, url, payload, actor] of cases) {
        const res = await app.inject({
          method: method as 'GET',
          url,
          headers: as(actor),
          ...(payload !== undefined ? { payload: payload as object } : {}),
        });
        expect(res.statusCode, `${method} ${url}`).toBe(400);
        expect(res.json().code).toBe('VALIDATION_ERROR');
        expect(res.json().requestId).toBeTruthy();
      }
    });
  });

  describe('routes: authorization (403, adversarial)', () => {
    it('denies BAR_STAFF everything except member lookup', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = await register(plan.id);
      const memberId = reg.json().member.id as string;
      const attempts = [
        ['GET', '/api/v1/members'],
        ['GET', `/api/v1/members/${memberId}`],
        ['GET', `/api/v1/members/${memberId}/timeline`],
        ['POST', `/api/v1/members/${memberId}/checkin`, {}],
        ['POST', `/api/v1/members/${memberId}/membership/renew`, { paymentMethod: 'CASH' }],
        ['POST', '/api/v1/members', { fullName: 'X', phone: MembersFixtures.phone(), planId: plan.id, paymentMethod: 'CASH' }],
        ['PUT', `/api/v1/plans/${plan.id}`, { name: 'Hacked' }],
        ['POST', '/api/v1/admin/jobs/membership-expiry', {}],
      ] as const;
      for (const [method, url, payload] of attempts) {
        const res = await app.inject({ method, url, headers: as(bar), ...(payload ? { payload } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      }
      const lookup = await app.inject({ method: 'GET', url: '/api/v1/members/lookup?q=M10', headers: as(bar) });
      expect(lookup.statusCode).toBe(200);
    });

    it('denies a MEMBER staff routes and other members profiles; allows only their own', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const victim = (await register(plan.id)).json().member.id as string;
      for (const [method, url, payload] of [
        ['GET', '/api/v1/members'],
        ['GET', `/api/v1/members/${victim}`],
        ['GET', `/api/v1/members/${victim}/timeline`],
        ['POST', `/api/v1/members/${victim}/checkin`, {}],
        ['POST', `/api/v1/members/${victim}/membership/renew`, { paymentMethod: 'CASH' }],
        ['GET', '/api/v1/members/lookup?q=M10'],
        ['PUT', `/api/v1/plans/${plan.id}`, { name: 'Hacked' }],
        ['POST', '/api/v1/admin/jobs/membership-expiry', {}],
      ] as const) {
        const res = await app.inject({ method, url, headers: as(memberUser), ...(payload ? { payload } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
      const [still] = await db.select().from(memberships).where(eq(memberships.memberId, victim));
      expect(still.status).toBe('ACTIVE');
    });

    it('denies FRONT_DESK the owner-only plan edit and admin job', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const put = await app.inject({ method: 'PUT', url: `/api/v1/plans/${plan.id}`, headers: as(desk), payload: { name: 'Nope' } });
      expect(put.statusCode).toBe(403);
      const job = await app.inject({ method: 'POST', url: '/api/v1/admin/jobs/membership-expiry', headers: as(desk), payload: {} });
      expect(job.statusCode).toBe(403);
      const [row] = await db.select().from(plans).where(eq(plans.id, plan.id));
      expect(row.name).toBe('M10 Test Plan');
    });

    it('denies a suspended front desk user', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const suspended = await fx.actor(app, 'FRONT_DESK');
      await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, suspended.id));
      // Sessions are cached in Redis with a user snapshot; drop it as a real suspension flow must.
      await app.redis.delete(`session:${hashSessionToken(suspended.cookie.split('=')[1]!)}`);
      const res = await app.inject({ method: 'GET', url: '/api/v1/members', headers: as(suspended) });
      expect([401, 403]).toContain(res.statusCode);
    });
  });

  describe('plans', () => {
    it('GET /plans lists plans for any authenticated user in contract shape', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan({ description: 'for tests' });
      const res = await app.inject({ method: 'GET', url: '/api/v1/plans', headers: as(memberUser) });
      expect(res.statusCode).toBe(200);
      const found = (res.json() as Array<Record<string, unknown>>).find((p) => p.id === plan.id);
      expect(found).toEqual({
        id: plan.id,
        code: plan.code,
        name: 'M10 Test Plan',
        description: 'for tests',
        monthlyFeePaise: 150000,
        courtDiscountPct: 30,
        shopDiscountPct: 8,
        barDiscountPct: 5,
        maxBookingsPerDay: 2,
        bookingHorizonDays: 7,
        minAge: null,
        maxAge: null,
        isActive: true,
      });
    });

    it('PUT /plans/:id lets the owner edit a plan, 404 for an unknown id', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/plans/${plan.id}`,
        headers: as(owner),
        payload: { name: 'Renamed', monthlyFeePaise: 200000, courtDiscountPct: 40, isActive: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Renamed', monthlyFeePaise: 200000, courtDiscountPct: 40, isActive: false });

      const missing = await app.inject({
        method: 'PUT',
        url: `/api/v1/plans/${randomUUID()}`,
        headers: as(owner),
        payload: { name: 'x' },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().code).toBe('NOT_FOUND');
    });

    it('refuses to sell an inactive plan', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan({ isActive: false });
      const res = await register(plan.id);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('PLAN_INACTIVE');
    });
  });

  describe('register', () => {
    it('creates member, membership, PAID invoice and payment in the contract shape', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const phone = MembersFixtures.phone();
      const res = await register(plan.id, { phone, email: 'aarav@example.com', dateOfBirth: '1994-05-17' });
      expect(res.statusCode).toBe(201);
      const body = CreateMemberResponseSchema.parse(res.json());

      expect(body.member.memberCode).toMatch(/^CC-\d{6}$/);
      expect(body.member).toMatchObject({ phone, email: 'aarav@example.com', hasLogin: false, photoUrl: null });
      expect(body.member.membership).toMatchObject({
        status: 'ACTIVE',
        startsOn: today(),
        endsOn: addDays(today(), 29),
        daysLeft: 29,
        expiryState: 'OK',
        cancelAtPeriodEnd: false,
        pendingPlan: null,
        plan: { id: plan.id, code: plan.code },
      });
      expect(body.member.entitlements).toEqual({
        courtDiscountPct: 30,
        shopDiscountPct: 8,
        barDiscountPct: 5,
        maxBookingsPerDay: 2,
        bookingHorizonDays: 7,
      });
      expect(body.invoice).toMatchObject({
        status: 'PAID',
        totalPaise: 150000,
        subtotalPaise: 150000,
        taxPaise: 22881,
        paidPaise: 150000,
        balancePaise: 0,
        billTo: { type: 'MEMBER', id: body.member.id, name: 'M10 Test Member' },
      });
      expect(body.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4,}$/);
      expect(body.invoice.lines).toEqual([
        { description: `${plan.name} membership, 30 days`, qty: 1, unitPricePaise: 150000, lineTotalPaise: 150000 },
      ]);
      expect(body.payment).toMatchObject({ amountPaise: 150000, method: 'UPI' });

      // Persisted rows.
      const [payment] = await db.select().from(payments).where(eq(payments.id, body.payment.id));
      expect(payment).toMatchObject({
        source: 'MEMBERSHIP',
        sourceId: body.member.membership!.id,
        kind: 'PAYMENT',
        memberId: body.member.id,
        receivedBy: desk.id,
      });
      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, body.invoice.id));
      expect(invoice.status).toBe('PAID');
      expect(invoice.paidAt).not.toBeNull();
      const [m] = await db.select().from(memberships).where(eq(memberships.id, body.member.membership!.id));
      expect(m.invoiceId).toBe(body.invoice.id);
      const events = await db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, m.id));
      expect(events.map((e) => e.type)).toEqual(['CREATED']);

      // The same data reads back identically.
      const read = await app.inject({ method: 'GET', url: `/api/v1/members/${body.member.id}`, headers: as(desk) });
      expect(read.statusCode).toBe(200);
      expect(MemberSchema.parse(read.json()).membership?.endsOn).toBe(addDays(today(), 29));
    });

    it('allocates sequential member codes from member_code_seq', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const a = (await register(plan.id)).json().member.memberCode as string;
      const b = (await register(plan.id)).json().member.memberCode as string;
      expect(Number(b.slice(3))).toBeGreaterThan(Number(a.slice(3)));
    });

    it('is atomic: a failure after the invoice and membership leaves nothing persisted', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const phone = MembersFixtures.phone();
      const actor = await fx.actor(app, 'FRONT_DESK');
      const failingPayments = {
        withExecutor: () => ({
          record: async () => {
            throw new Error('injected failure while recording the payment');
          },
        }),
      } as unknown as PaymentService;
      const service = new MembershipService(db, { payments: failingPayments });

      await expect(
        service.register(
          { fullName: 'Rolled Back', phone, planId: plan.id, paymentMethod: 'CASH' },
          actor.id
        )
      ).rejects.toThrow('injected failure');

      expect(await db.select().from(members).where(eq(members.phone, phone))).toHaveLength(0);
      const [{ n: planTerms }] = await db.select({ n: count() }).from(memberships).where(eq(memberships.planId, plan.id));
      expect(Number(planTerms)).toBe(0);
      const [{ n: invoiceCount }] = await db.select({ n: count() }).from(invoices).where(eq(invoices.createdBy, actor.id));
      expect(Number(invoiceCount)).toBe(0);
      const [{ n: paymentCount }] = await db.select({ n: count() }).from(payments).where(eq(payments.receivedBy, actor.id));
      expect(Number(paymentCount)).toBe(0);
    });

    it('is atomic when the invoice step fails first as well', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const phone = MembersFixtures.phone();
      const failingInvoices = {
        withExecutor: () => ({
          createPaidMembershipInvoice: async () => {
            throw new Error('injected invoice failure');
          },
        }),
      } as unknown as InvoiceService;
      const service = new MembershipService(db, { invoices: failingInvoices });
      await expect(
        service.register({ fullName: 'Rolled Back', phone, planId: plan.id, paymentMethod: 'CASH' }, null)
      ).rejects.toThrow('injected invoice failure');
      expect(await db.select().from(members).where(eq(members.phone, phone))).toHaveLength(0);
    });

    it('refuses a Junior plan when the member is 18 or older (422 JUNIOR_AGE_INVALID)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const junior = await fx.plan({ code: `T10J-${randomUUID().slice(0, 10)}`, monthlyFeePaise: 80000, maxAge: 17 });
      const eighteenth = addDays(today(), -365 * 18 - 5);
      const old = await register(junior.id, { dateOfBirth: eighteenth });
      expect(old.statusCode).toBe(422);
      expect(old.json().code).toBe('JUNIOR_AGE_INVALID');
      expect(old.json().requestId).toBeTruthy();

      const missingDob = await register(junior.id);
      expect(missingDob.statusCode).toBe(422);
      expect(missingDob.json().code).toBe('JUNIOR_AGE_INVALID');

      const kid = await register(junior.id, { dateOfBirth: addDays(today(), -365 * 10) });
      expect(kid.statusCode).toBe(201);
      expect(kid.json().member.membership.plan.id).toBe(junior.id);
    });

    it('refuses a second active membership for the same phone (409)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const phone = MembersFixtures.phone();
      const first = await register(plan.id, { phone });
      expect(first.statusCode).toBe(201);
      const second = await register(plan.id, { phone });
      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe('MEMBER_HAS_ACTIVE_MEMBERSHIP');
      const [{ n }] = await db.select({ n: count() }).from(memberships).where(eq(memberships.planId, plan.id));
      expect(Number(n)).toBe(1);
    });

    it('two concurrent registrations of one phone yield one 201 and one 409', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const phone = MembersFixtures.phone();
      const results = await Promise.all([register(plan.id, { phone }), register(plan.id, { phone })]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await db.select().from(members).where(eq(members.phone, phone))).toHaveLength(1);
    });

    it('a returning member whose term lapsed can be registered again without a duplicate profile', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const phone = MembersFixtures.phone();
      const first = await register(plan.id, { phone });
      await db.update(memberships).set({ status: 'EXPIRED', endsOn: addDays(today(), -3) }).where(eq(memberships.planId, plan.id));
      const again = await register(plan.id, { phone });
      expect(again.statusCode).toBe(201);
      expect(again.json().member.id).toBe(first.json().member.id);
      expect(again.json().member.membership.status).toBe('ACTIVE');
    });
  });

  describe('renew', () => {
    it('extends from the day after the current term, replaces the old row and records payment + invoice', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = (await register(plan.id)).json();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${reg.member.id}/membership/renew`,
        headers: as(desk),
        payload: { paymentMethod: 'CARD' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.member.membership).toMatchObject({
        status: 'ACTIVE',
        startsOn: addDays(today(), 30),
        endsOn: addDays(today(), 59),
      });
      expect(body.invoice).toMatchObject({ status: 'PAID', totalPaise: 150000 });
      expect(body.invoice.id).not.toBe(reg.invoice.id);
      expect(body.payment).toMatchObject({ amountPaise: 150000, method: 'CARD' });

      const terms = await db.select().from(memberships).where(eq(memberships.memberId, reg.member.id));
      expect(terms.filter((t) => t.status === 'ACTIVE')).toHaveLength(1);
      expect(terms.filter((t) => t.status === 'REPLACED')).toHaveLength(1);
      const events = await db.select().from(membershipEvents).where(eq(membershipEvents.memberId, reg.member.id));
      expect(events.map((e) => e.type).sort()).toEqual(['CREATED', 'RENEWED']);
    });

    it('starts today when the membership has already lapsed', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = (await register(plan.id)).json();
      await db
        .update(memberships)
        .set({ status: 'EXPIRED', startsOn: addDays(today(), -33), endsOn: addDays(today(), -3) })
        .where(eq(memberships.memberId, reg.member.id));
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${reg.member.id}/membership/renew`,
        headers: as(desk),
        payload: { paymentMethod: 'CASH' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().member.membership).toMatchObject({ status: 'ACTIVE', startsOn: today(), endsOn: addDays(today(), 29) });
    });

    it('two concurrent renewals never produce two active memberships or two charges', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = (await register(plan.id)).json();
      const renew = () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/members/${reg.member.id}/membership/renew`,
          headers: as(desk),
          payload: { paymentMethod: 'CASH' },
        });
      const results = await Promise.all([renew(), renew()]);
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      const terms = await db.select().from(memberships).where(eq(memberships.memberId, reg.member.id));
      expect(terms.filter((t) => t.status === 'ACTIVE')).toHaveLength(1);
      expect(terms).toHaveLength(3); // original, then two serialised renewals
    });

    it('404 for an unknown member and 422 for a member who never had a membership', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const unknown = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${randomUUID()}/membership/renew`,
        headers: as(desk),
        payload: { paymentMethod: 'CASH' },
      });
      expect(unknown.statusCode).toBe(404);

      const [bare] = await db
        .insert(members)
        .values({ memberCode: `CC-9${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`, fullName: 'No Plan', phone: MembersFixtures.phone() })
        .returning();
      fx.memberIds.push(bare.id);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${bare.id}/membership/renew`,
        headers: as(desk),
        payload: { paymentMethod: 'CASH' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('NO_MEMBERSHIP_TO_RENEW');
    });

    it('refuses to renew a Junior who has turned 18 (422 JUNIOR_AGE_INVALID)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const junior = await fx.plan({ monthlyFeePaise: 80000, maxAge: 17 });
      const reg = (await register(junior.id, { dateOfBirth: addDays(today(), -365 * 17 - 20) })).json();
      // The term is 30 days; renewing a month later crosses the 18th birthday.
      await db.update(members).set({ dateOfBirth: addDays(today(), -365 * 18 - 40) }).where(eq(members.id, reg.member.id));
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${reg.member.id}/membership/renew`,
        headers: as(desk),
        payload: { paymentMethod: 'CASH' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('JUNIOR_AGE_INVALID');
    });
  });

  describe('lookup, list, check-in and timeline', () => {
    it('lookup finds by name, phone and code and flags expired members', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan({ code: `T10L-${randomUUID().slice(0, 10)}` });
      const unique = `Zq${randomUUID().slice(0, 6)}`;
      const phone = MembersFixtures.phone();
      const reg = (await register(plan.id, { fullName: `${unique} Lookup`, phone })).json();

      for (const q of [unique, unique.toLowerCase(), phone.slice(-8), reg.member.memberCode]) {
        const res = await app.inject({ method: 'GET', url: `/api/v1/members/lookup?q=${encodeURIComponent(q)}`, headers: as(desk) });
        expect(res.statusCode, q).toBe(200);
        const hit = (res.json() as Array<Record<string, unknown>>).find((r) => r.id === reg.member.id);
        expect(hit, q).toEqual({
          id: reg.member.id,
          memberCode: reg.member.memberCode,
          fullName: `${unique} Lookup`,
          phone,
          planCode: plan.code,
          expiryState: 'OK',
          barDiscountPct: 5,
          shopDiscountPct: 8,
        });
      }

      await db.update(memberships).set({ endsOn: addDays(today(), -1), status: 'EXPIRED' }).where(eq(memberships.memberId, reg.member.id));
      const expired = await app.inject({ method: 'GET', url: `/api/v1/members/lookup?q=${unique}`, headers: as(bar) });
      expect(expired.json()[0]).toMatchObject({ expiryState: 'EXPIRED', barDiscountPct: 0, shopDiscountPct: 0 });
    });

    it('lookup treats LIKE wildcards in the query literally', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await app.inject({ method: 'GET', url: '/api/v1/members/lookup?q=%25%25', headers: as(desk) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('list paginates and filters by plan and expiry status', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const unique = `Lst${randomUUID().slice(0, 6)}`;
      const ok = (await register(plan.id, { fullName: `${unique} ok` })).json().member.id as string;
      const soon = (await register(plan.id, { fullName: `${unique} soon` })).json().member.id as string;
      const gone = (await register(plan.id, { fullName: `${unique} gone` })).json().member.id as string;
      await db.update(memberships).set({ endsOn: addDays(today(), 3) }).where(eq(memberships.memberId, soon));
      await db.update(memberships).set({ endsOn: addDays(today(), -2), status: 'EXPIRED' }).where(eq(memberships.memberId, gone));

      const ids = async (qs: string) => {
        const res = await app.inject({ method: 'GET', url: `/api/v1/members?q=${unique}&planCode=${plan.code}&${qs}`, headers: as(desk) });
        expect(res.statusCode).toBe(200);
        return (res.json().data as Array<{ id: string }>).map((m) => m.id).sort();
      };
      expect(await ids('')).toEqual([ok, soon, gone].sort());
      expect(await ids('status=ACTIVE')).toEqual([ok, soon].sort());
      expect(await ids('status=EXPIRING_SOON')).toEqual([soon]);
      expect(await ids('status=EXPIRED')).toEqual([gone]);
      expect(await ids('status=NONE')).toEqual([]);

      const page = await app.inject({
        method: 'GET',
        url: `/api/v1/members?q=${unique}&limit=2&page=2&sort=fullName&order=asc`,
        headers: as(desk),
      });
      expect(page.json().meta).toMatchObject({ page: 2, limit: 2, totalItems: 3, totalPages: 2, hasNextPage: false, hasPrevPage: true });
      expect(page.json().data).toHaveLength(1);
    });

    it('check-in returns 201 with the expiry state so the desk can warn', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = (await register(plan.id)).json();
      const ok = await app.inject({ method: 'POST', url: `/api/v1/members/${reg.member.id}/checkin`, headers: as(desk), payload: {} });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ member: { id: reg.member.id, membership: { expiryState: 'OK' } } });
      expect(typeof ok.json().checkedInAt).toBe('string');

      await db.update(memberships).set({ endsOn: addDays(today(), -1), status: 'EXPIRED' }).where(eq(memberships.memberId, reg.member.id));
      const expired = await app.inject({ method: 'POST', url: `/api/v1/members/${reg.member.id}/checkin`, headers: as(owner) });
      expect(expired.statusCode).toBe(201);
      expect(expired.json().member.membership.expiryState).toBe('EXPIRED');

      const unknown = await app.inject({ method: 'POST', url: `/api/v1/members/${randomUUID()}/checkin`, headers: as(desk), payload: {} });
      expect(unknown.statusCode).toBe(404);
      const badBooking = await app.inject({
        method: 'POST',
        url: `/api/v1/members/${reg.member.id}/checkin`,
        headers: as(desk),
        payload: { bookingId: randomUUID() },
      });
      expect(badBooking.statusCode).toBe(404);
    });

    it('timeline merges check-ins, invoices and membership events newest first with paging', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = (await register(plan.id)).json();
      await app.inject({ method: 'POST', url: `/api/v1/members/${reg.member.id}/checkin`, headers: as(desk), payload: {} });

      const res = await app.inject({ method: 'GET', url: `/api/v1/members/${reg.member.id}/timeline`, headers: as(desk) });
      expect(res.statusCode).toBe(200);
      const { data, meta } = res.json();
      expect(meta.totalItems).toBe(3);
      expect(data.map((d: { type: string }) => d.type).sort()).toEqual(['CHECKIN', 'INVOICE', 'MEMBERSHIP']);
      const times = data.map((d: { at: string }) => Date.parse(d.at));
      expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
      const invoiceItem = data.find((d: { type: string }) => d.type === 'INVOICE');
      expect(invoiceItem).toMatchObject({ amountPaise: 150000, link: `/invoices/${reg.invoice.id}` });
      expect(invoiceItem.title).toBe(`Invoice ${reg.invoice.invoiceNumber}`);

      const paged = await app.inject({ method: 'GET', url: `/api/v1/members/${reg.member.id}/timeline?limit=2&page=2`, headers: as(desk) });
      expect(paged.json().data).toHaveLength(1);
      expect(paged.json().meta).toMatchObject({ page: 2, totalPages: 2, hasNextPage: false });

      const missing = await app.inject({ method: 'GET', url: `/api/v1/members/${randomUUID()}/timeline`, headers: as(desk) });
      expect(missing.statusCode).toBe(404);
    });

    it('GET /members/:id is 404 for an unknown id', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await app.inject({ method: 'GET', url: `/api/v1/members/${randomUUID()}`, headers: as(owner) });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });
  });

  describe('/me/member', () => {
    it('returns 404 NOT_A_MEMBER for a fresh signup, then 200 after PUT creates the profile', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const fresh = await fx.actor(app, 'MEMBER');
      const none = await app.inject({ method: 'GET', url: '/api/v1/me/member', headers: as(fresh) });
      expect(none.statusCode).toBe(404);
      expect(none.json().code).toBe('NOT_A_MEMBER');

      const phone = MembersFixtures.phone();
      const put = await app.inject({
        method: 'PUT',
        url: '/api/v1/me/member',
        headers: as(fresh),
        payload: { fullName: 'Self Service', phone, dateOfBirth: '2001-02-03' },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({ fullName: 'Self Service', phone, hasLogin: true, membership: null });
      expect(put.json().entitlements).toEqual({
        courtDiscountPct: 0,
        shopDiscountPct: 0,
        barDiscountPct: 0,
        maxBookingsPerDay: 0,
        bookingHorizonDays: 0,
      });

      const again = await app.inject({
        method: 'PUT',
        url: '/api/v1/me/member',
        headers: as(fresh),
        payload: { fullName: 'Renamed Self', phone },
      });
      expect(again.json()).toMatchObject({ id: put.json().id, memberCode: put.json().memberCode, fullName: 'Renamed Self', dateOfBirth: '2001-02-03' });

      const got = await app.inject({ method: 'GET', url: '/api/v1/me/member', headers: as(fresh) });
      expect(got.statusCode).toBe(200);
      expect(got.json().id).toBe(put.json().id);
    });

    it('never returns another user\'s profile', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const a = await fx.actor(app, 'MEMBER');
      const b = await fx.actor(app, 'MEMBER');
      await app.inject({ method: 'PUT', url: '/api/v1/me/member', headers: as(a), payload: { fullName: 'Alice A', phone: MembersFixtures.phone() } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/me/member', headers: as(b) });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('Alice A');
    });

    it('shows the plan and expiry once staff register the same user as a member', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plan = await fx.plan();
      const reg = (await register(plan.id)).json();
      const user = await fx.actor(app, 'MEMBER');
      await db.update(members).set({ userId: user.id }).where(eq(members.id, reg.member.id));
      const res = await app.inject({ method: 'GET', url: '/api/v1/me/member', headers: as(user) });
      expect(res.statusCode).toBe(200);
      expect(res.json().membership.plan.id).toBe(plan.id);
      expect(res.json().hasLogin).toBe(true);
    });
  });
});
