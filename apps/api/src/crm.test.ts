import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hashSessionToken } from '@packages/auth';
import { invoices, leadActivities, leads, members, memberships, notifications, payments, quotes, users } from '@packages/db';
import { CrmSummarySchema, ConvertLeadResponseSchema, LeadDetailSchema, LeadPageSchema, LeadSchema, LeadActivitySchema, QuoteSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { addDays, clubDateOf } from './lib/club-date.js';
import { CrmService } from './services/crm.service.js';
import { InvoiceService } from './services/invoice.service.js';
import { MembershipService } from './services/membership.service.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const TZ = 'Asia/Kolkata';
const today = () => clubDateOf(new Date(), TZ);
const id = randomUUID();
const base = '/api/v1/crm';
const leadInput = () => ({ name: `M13 ${randomUUID()}`, phone: MembersFixtures.phone(), source: 'WALK_IN' as const });

// Valid bodies ensure authentication/authorization, rather than validation, decides the response.
const guardedRoutes = [
  ['GET', `${base}/leads`, undefined],
  ['GET', `${base}/summary`, undefined],
  ['POST', `${base}/leads`, { name: 'M13 Guard', phone: '+919800000000', source: 'PHONE' }],
  ['GET', `${base}/leads/${id}`, undefined],
  ['PATCH', `${base}/leads/${id}`, { status: 'CONTACTED' }],
  ['POST', `${base}/leads/${id}/activities`, { type: 'NOTE', body: 'Follow up' }],
  ['POST', `${base}/leads/${id}/quotes`, { planId: id }],
  ['POST', `${base}/quotes/${id}/send`, undefined],
  ['PATCH', `${base}/quotes/${id}`, { status: 'ACCEPTED' }],
  ['POST', `${base}/leads/${id}/convert`, { planId: id, paymentMethod: 'CASH' }],
] as const;

describe('CRM (M-13, API contract section 9)', () => {
  const fx = new MembersFixtures();
  const db = fx.db;
  const leadIds: string[] = [];
  let app: FastifyInstance;
  let hasDatabase = false;
  let desk: Actor;
  let owner: Actor;
  let bar: Actor;
  let member: Actor;
  const as = (actor: Actor) => ({ cookie: actor.cookie });

  async function createLead(extra: Record<string, unknown> = {}, actor: Actor = desk) {
    const response = await app.inject({ method: 'POST', url: `${base}/leads`, headers: as(actor), payload: { ...leadInput(), ...extra } });
    expect(response.statusCode, response.body).toBe(201);
    const lead = LeadSchema.parse(response.json());
    leadIds.push(lead.id);
    return lead;
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
      member = await fx.actor(app, 'MEMBER');
    }
  });

  afterAll(async () => {
    try {
      if (hasDatabase) {
        if (leadIds.length) {
          // Notifications fan out to existing staff too; remove only this suite's lead notifications.
          await db.delete(notifications).where(inArray(notifications.link, leadIds.map((leadId) => `/crm/leads/${leadId}`)));
          await db.delete(leads).where(inArray(leads.id, leadIds));
        }
        await fx.cleanup();
      }
    } finally {
      await app.close();
    }
  });

  it.each(guardedRoutes)('%s %s requires authentication', async (method, url, payload) => {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED', requestId: expect.any(String) });
  });

  it.each(guardedRoutes)('%s %s rejects both MEMBER and BAR_STAFF', async (method, url, payload, ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const actor of [member, bar]) {
      const response = await app.inject({ method, url, headers: as(actor), ...(payload ? { payload } : {}) });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN', requestId: expect.any(String) });
    }
  });

  it('rejects malformed query, IDs, contact data, transitions and money', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const cases = [
      ['GET', `${base}/leads?page=0`],
      ['GET', `${base}/leads?limit=1000`],
      ['GET', `${base}/leads?status=WAT`],
      ['GET', `${base}/leads?assignedTo=nope`],
      ['GET', `${base}/leads?dueToday=yes`],
      ['GET', `${base}/leads/not-a-uuid`],
      ['POST', `${base}/leads`, { name: 'No contact', source: 'PHONE' }],
      ['POST', `${base}/leads`, { ...leadInput(), source: 'WEBSITE_ENQUIRY' }],
      ['POST', `${base}/leads`, { ...leadInput(), phone: 'abc', email: 'invalid' }],
      ['PATCH', `${base}/leads/${id}`, { status: 'WON' }],
      ['PATCH', `${base}/leads/${id}`, { status: 'LOST' }],
      ['PATCH', `${base}/leads/${id}`, { nextFollowUpAt: 'invalid' }],
      ['POST', `${base}/leads/${id}/activities`, { type: 'CONVERTED', body: 'Forged' }],
      ['POST', `${base}/leads/${id}/activities`, { type: 'NOTE', body: '' }],
      ['POST', `${base}/leads/${id}/quotes`, { planId: id, amountPaise: -1 }],
      ['POST', `${base}/leads/${id}/quotes`, { planId: id, validUntil: '2026-02-30' }],
      ['POST', `${base}/quotes/not-a-uuid/send`],
      ['PATCH', `${base}/quotes/${id}`, { status: 'SENT' }],
      ['POST', `${base}/leads/${id}/convert`, { planId: id, paymentMethod: 'BITCOIN' }],
    ] as const;
    for (const [method, url, payload] of cases) {
      const response = await app.inject({ method, url, headers: as(desk), ...(payload ? { payload } : {}) });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', requestId: expect.any(String) });
      expect(response.json().requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('denies suspended staff even with a previously valid session', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const suspended = await fx.actor(app, 'FRONT_DESK');
    await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, suspended.id));
    await app.redis.delete(`session:${hashSessionToken(suspended.cookie.split('=')[1]!)}`);
    for (const [method, url, payload] of guardedRoutes) {
      const response = await app.inject({ method, url, headers: as(suspended), ...(payload ? { payload } : {}) });
      expect([401, 403]).toContain(response.statusCode);
    }
  });

  it('creates, assigns, follows up, lists and records activities with contract shapes', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const lead = await createLead({}, owner);
    expect(lead).toMatchObject({ status: 'NEW', memberId: null });
    for (const recipient of [desk, owner]) {
      expect(await db.select().from(notifications).where(and(eq(notifications.userId, recipient.id), eq(notifications.type, 'NEW_LEAD'), eq(notifications.link, `/crm/leads/${lead.id}`)))).toHaveLength(1);
    }
    for (const recipient of [bar, member]) {
      expect(await db.select().from(notifications).where(and(eq(notifications.userId, recipient.id), eq(notifications.type, 'NEW_LEAD'), eq(notifications.link, `/crm/leads/${lead.id}`)))).toHaveLength(0);
    }
    const updated = await app.inject({ method: 'PATCH', url: `${base}/leads/${lead.id}`, headers: as(desk), payload: { status: 'CONTACTED', assignedTo: desk.id, nextFollowUpAt: new Date(`${today()}T12:00:00+05:30`).toISOString() } });
    expect(updated.statusCode).toBe(200);
    expect(LeadSchema.parse(updated.json())).toMatchObject({ status: 'CONTACTED', assignedTo: { id: desk.id } });
    for (const type of ['NOTE', 'CALL', 'EMAIL']) {
      const response = await app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/activities`, headers: as(desk), payload: { type, body: `M13 ${type}` } });
      expect(response.statusCode).toBe(201);
      expect(LeadActivitySchema.parse(response.json())).toMatchObject({ type, body: `M13 ${type}`, actor: { id: desk.id } });
    }
    const detail = await app.inject({ method: 'GET', url: `${base}/leads/${lead.id}`, headers: as(owner) });
    expect(detail.statusCode).toBe(200);
    const parsed = LeadDetailSchema.parse(detail.json());
    expect(parsed.lead.id).toBe(lead.id);
    expect(parsed.activities.map((activity) => activity.type)).toEqual(expect.arrayContaining(['STATUS_CHANGE', 'NOTE', 'CALL', 'EMAIL']));
    expect(parsed.quotes).toEqual([]);
    for (const filter of ['status=CONTACTED', 'source=WALK_IN', `assignedTo=${desk.id}`, 'dueToday=true']) {
      const response = await app.inject({ method: 'GET', url: `${base}/leads?q=${encodeURIComponent(lead.name)}&${filter}&page=1&limit=1`, headers: as(desk) });
      expect(response.statusCode).toBe(200);
      const page = LeadPageSchema.parse(response.json());
      expect(page.data).toMatchObject([{ id: lead.id, quoteCount: 0 }]);
      expect(page.meta.totalItems).toBe(1);
    }
    const lost = await app.inject({ method: 'PATCH', url: `${base}/leads/${lead.id}`, headers: as(desk), payload: { status: 'LOST', lostReason: 'Moved away' } });
    expect(lost.statusCode).toBe(200);
    expect(LeadSchema.parse(lost.json()).status).toBe('LOST');
    const summary = await app.inject({ method: 'GET', url: `${base}/summary`, headers: as(owner) });
    expect(summary.statusCode).toBe(200);
    expect(CrmSummarySchema.parse(summary.json()).byStatus.LOST).toBeGreaterThanOrEqual(1);
  });

  it('creates default and custom quotes, sends and accepts or rejects them', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const plan = await fx.plan();
    const lead = await createLead({ interestedPlanId: plan.id });
    for (const custom of [false, true]) {
      const payload = { planId: plan.id, ...(custom ? { amountPaise: 99000, validUntil: addDays(today(), 7), notes: 'Offer' } : {}) };
      const created = await app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/quotes`, headers: as(desk), payload });
      expect(created.statusCode).toBe(201);
      const quote = QuoteSchema.parse(created.json());
      expect(quote).toMatchObject({ leadId: lead.id, plan: { id: plan.id }, status: 'DRAFT', amountPaise: custom ? 99000 : plan.monthlyFeePaise, validUntil: addDays(today(), custom ? 7 : 14) });
      const sent = await app.inject({ method: 'POST', url: `${base}/quotes/${quote.id}/send`, headers: as(owner) });
      expect(sent.statusCode).toBe(200);
      expect(QuoteSchema.parse(sent.json()).status).toBe('SENT');
      const status = custom ? 'REJECTED' : 'ACCEPTED';
      const decision = await app.inject({ method: 'PATCH', url: `${base}/quotes/${quote.id}`, headers: as(desk), payload: { status } });
      expect(decision.statusCode).toBe(200);
      expect(QuoteSchema.parse(decision.json()).status).toBe(status);
    }
    const detail = LeadDetailSchema.parse((await app.inject({ method: 'GET', url: `${base}/leads/${lead.id}`, headers: as(desk) })).json());
    expect(detail.lead.status).toBe('QUOTED');
    expect(detail.quotes).toHaveLength(2);
    expect(detail.activities.map((activity) => activity.type)).toContain('QUOTE_SENT');
  });

  it('returns 404 for unknown resources on every resource route', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    for (const [method, url, payload] of guardedRoutes.slice(3)) {
      const response = await app.inject({ method, url, headers: as(desk), ...(payload ? { payload } : {}) });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().code).toBe('NOT_FOUND');
    }
  });

  it('rejects invalid quote transitions and conversion with another lead, plan or expired quote', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const plan = await fx.plan();
    const otherPlan = await fx.plan();
    const lead = await createLead();
    const otherLead = await createLead();
    const response = await app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/quotes`, headers: as(desk), payload: { planId: plan.id } });
    expect(response.statusCode).toBe(201);
    const quote = QuoteSchema.parse(response.json());
    const decide = () => app.inject({ method: 'PATCH', url: `${base}/quotes/${quote.id}`, headers: as(desk), payload: { status: 'ACCEPTED' } });
    const send = () => app.inject({ method: 'POST', url: `${base}/quotes/${quote.id}/send`, headers: as(desk) });
    const convert = (leadId: string, planId = plan.id) => app.inject({ method: 'POST', url: `${base}/leads/${leadId}/convert`, headers: as(desk), payload: { planId, quoteId: quote.id, paymentMethod: 'CASH' } });
    expect((await decide()).statusCode).toBe(409);
    expect((await convert(lead.id)).statusCode).toBe(422);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(409);
    const rejected = await app.inject({ method: 'PATCH', url: `${base}/quotes/${quote.id}`, headers: as(desk), payload: { status: 'REJECTED' } });
    expect(rejected.statusCode).toBe(200);
    expect((await convert(lead.id)).statusCode).toBe(422);
    // Isolate the accepted-quote ownership and expiry cases from the rejected state.
    await db.update(quotes).set({ status: 'SENT' }).where(eq(quotes.id, quote.id));
    expect((await decide()).statusCode).toBe(200);
    for (const [leadId, planId] of [[otherLead.id, plan.id], [lead.id, otherPlan.id]]) {
      const invalid = await convert(leadId, planId);
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().code).toBe('QUOTE_INVALID');
    }
    await db.update(quotes).set({ validUntil: addDays(today(), -1) }).where(eq(quotes.id, quote.id));
    expect((await convert(lead.id)).statusCode).toBe(422);
    await db.update(quotes).set({ status: 'DRAFT' }).where(eq(quotes.id, quote.id));
    expect((await send()).statusCode).toBe(409);
    expect(await db.select().from(members).where(eq(members.phone, lead.phone!))).toHaveLength(0);
    expect(await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, lead.id), eq(leadActivities.type, 'CONVERTED')))).toHaveLength(0);
  });

  it('serializes two concurrent conversions and persists exactly one sale and CONVERTED activity', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const plan = await fx.plan();
    const lead = await createLead();
    const convert = () => app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/convert`, headers: as(desk), payload: { planId: plan.id, paymentMethod: 'UPI' } });
    const results = await Promise.all([convert(), convert()]);
    expect(results.map((response) => response.statusCode).sort(), results.map((response) => response.body).join('\n')).toEqual([201, 409]);
    const success = ConvertLeadResponseSchema.parse(results.find((response) => response.statusCode === 201)!.json());
    fx.memberIds.push(success.member.id);
    expect(success.lead).toMatchObject({ id: lead.id, status: 'WON', memberId: success.member.id });
    expect(success.invoice).toMatchObject({ status: 'PAID', totalPaise: plan.monthlyFeePaise });
    expect(success.payment).toMatchObject({ method: 'UPI', amountPaise: plan.monthlyFeePaise });
    expect(results.find((response) => response.statusCode === 409)!.json().code).toBe('ALREADY_CONVERTED');
    expect((await convert()).json().code).toBe('ALREADY_CONVERTED');
    for (const status of ['NEW', 'CONTACTED', 'LOST']) {
      const mutation = await app.inject({ method: 'PATCH', url: `${base}/leads/${lead.id}`, headers: as(owner), payload: { status, ...(status === 'LOST' ? { lostReason: 'Undo conversion' } : {}) } });
      expect(mutation.statusCode).toBe(409);
      expect(mutation.json().code).toBe('ALREADY_CONVERTED');
    }
    const [persistedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(persistedLead).toMatchObject({ status: 'WON', memberId: success.member.id });
    expect(await db.select().from(members).where(eq(members.phone, lead.phone!))).toHaveLength(1);
    expect(await db.select().from(memberships).where(eq(memberships.memberId, success.member.id))).toHaveLength(1);
    expect(await db.select().from(invoices).where(eq(invoices.memberId, success.member.id))).toHaveLength(1);
    expect(await db.select().from(payments).where(eq(payments.memberId, success.member.id))).toHaveLength(1);
    expect(await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, lead.id), eq(leadActivities.type, 'CONVERTED')))).toHaveLength(1);
  });

  it('rolls back member, membership, invoice, payment and lead state if invoicing fails', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const actor = await fx.actor(app, 'FRONT_DESK');
    const plan = await fx.plan();
    const lead = await createLead({}, actor);
    const before = await db.select().from(leadActivities).where(eq(leadActivities.leadId, lead.id));
    const failInvoice = vi.fn(async () => { throw new Error('M13 injected invoice failure'); });
    const failingInvoices = { withExecutor: () => ({ createPaidMembershipInvoice: failInvoice }) } as unknown as InvoiceService;
    const membershipService = new MembershipService(db, { invoices: failingInvoices });
    const service = new CrmService(db, TZ, membershipService);
    await expect(service.convert(lead.id, { planId: plan.id, paymentMethod: 'CASH' }, actor.id)).rejects.toThrow('M13 injected invoice failure');
    expect(failInvoice).toHaveBeenCalledOnce();
    expect(await db.select().from(members).where(eq(members.phone, lead.phone!))).toHaveLength(0);
    expect(await db.select().from(memberships).where(eq(memberships.planId, plan.id))).toHaveLength(0);
    expect(await db.select().from(invoices).where(eq(invoices.createdBy, actor.id))).toHaveLength(0);
    expect(await db.select().from(payments).where(eq(payments.receivedBy, actor.id))).toHaveLength(0);
    expect(await db.select().from(leadActivities).where(eq(leadActivities.leadId, lead.id))).toEqual(before);
    const [unchanged] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(unchanged).toMatchObject({ status: 'NEW', memberId: null, convertedAt: null });
  });

  it('requires a phone for email-only leads and rejects ineligible Junior conversion atomically', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const plan = await fx.plan({ maxAge: 17 });
    const lead = await createLead({ phone: undefined, email: `m13-${randomUUID()}@example.com` });
    const payload = { planId: plan.id, paymentMethod: 'CASH' };
    const missingPhone = await app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/convert`, headers: as(desk), payload });
    expect(missingPhone.statusCode).toBe(422);
    expect(missingPhone.json().code).toBe('PHONE_REQUIRED');
    const phone = MembersFixtures.phone();
    const adult = await app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/convert`, headers: as(desk), payload: { ...payload, phone, dateOfBirth: addDays(today(), -365 * 20) } });
    expect(adult.statusCode).toBe(422);
    expect(adult.json().code).toBe('JUNIOR_AGE_INVALID');
    expect(await db.select().from(members).where(eq(members.phone, phone))).toHaveLength(0);
    const converted = await app.inject({ method: 'POST', url: `${base}/leads/${lead.id}/convert`, headers: as(owner), payload: { ...payload, phone, dateOfBirth: addDays(today(), -365 * 10) } });
    expect(converted.statusCode).toBe(201);
    const result = ConvertLeadResponseSchema.parse(converted.json());
    fx.memberIds.push(result.member.id);
    expect(result.member.phone).toBe(phone);
  });

  it('documents every CRM route in OpenAPI', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(response.statusCode).toBe(200);
    const paths = response.json().paths;
    for (const [method, url] of guardedRoutes) {
      expect(paths[url.replace(id, '{id}')]?.[method.toLowerCase()], `${method} ${url}`).toBeDefined();
    }
  });
});
