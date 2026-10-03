import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { bookings, courts, getDb, leads, notifications, plans, products } from '@packages/db';
import { CreateTrialBookingResponseSchema, PlanListSchema, PublicClubSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { CrmService } from './services/crm.service.js';
import { addDays, clubDateOf, clubWallTimeToInstant } from './services/time.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { FixtureTracker, createCourt, createCourtType, createPlan } from './test-support/court-fixtures.js';
import { MembersFixtures } from './test-support/members-fixtures.js';

describe('M-13 public website (HTTP integration)', () => {
  const db = getDb();
  const tracker = new FixtureTracker();
  const actors = new MembersFixtures();
  const prefix = `public-${randomUUID()}`;
  const productIds: string[] = [];
  let app: FastifyInstance;
  let available = false;
  let courtId: string;
  let typeId: string;
  let ownerId: string;
  let deskId: string;
  let memberId: string;
  let ip = 0;
  const startsAt = (hour: number) => clubWallTimeToInstant(
    addDays(clubDateOf(new Date(), 'Asia/Kolkata'), 1), hour * 60, 'Asia/Kolkata',
  ).toISOString();
  const call = (method: 'GET' | 'POST', path: string, payload?: object, remoteAddress?: string) =>
    app.inject({ method, url: `/api/v1/public${path}`, payload, remoteAddress: remoteAddress ?? `10.113.0.${++ip}` });
  const enquiry = () => ({ name: prefix, email: `${randomUUID()}@example.com`, message: 'Tell me about membership.' });
  const trial = (hour: number, phone = MembersFixtures.phone()) => ({
    courtId, startsAt: startsAt(hour), name: prefix, phone, email: `${randomUUID()}@example.com`,
  });

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    if (!available) return;
    app = buildApp();
    await app.ready();
    MembersFixtures.spreadClientIps(app);
    const type = await createCourtType(db);
    typeId = type.id;
    tracker.courtTypeIds.push(type.id);
    const court = await createCourt(db, type.id);
    courtId = court.id;
    tracker.courtIds.push(court.id);
    ownerId = (await actors.actor(app, 'OWNER')).id;
    deskId = (await actors.actor(app, 'FRONT_DESK')).id;
    memberId = (await actors.actor(app, 'MEMBER')).id;
  });

  afterAll(async () => {
    if (available) {
      await tracker.cleanup(db);
      const rows = await db.select({ id: leads.id }).from(leads).where(like(leads.name, `${prefix}%`));
      for (const row of rows) await db.delete(notifications).where(eq(notifications.link, `/crm/leads/${row.id}`));
      if (rows.length) await db.delete(leads).where(inArray(leads.id, rows.map((row) => row.id)));
      if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
      await actors.cleanup();
    }
    if (app) await app.close();
  });

  it('serves only public club fields and counts active courts', async (ctx) => {
    if (!available) return ctx.skip();
    const inactive = await createCourt(db, typeId);
    tracker.courtIds.push(inactive.id);
    await db.update(courts).set({ isActive: false }).where(eq(courts.id, inactive.id));
    const response = await call('GET', '/club');
    expect(response.statusCode).toBe(200);
    const body = PublicClubSchema.parse(response.json());
    expect(body.courtTypes.find((type) => type.id === typeId)?.courtCount).toBe(1);
    expect(Object.keys(response.json()).sort()).toEqual(Object.keys(body).sort());
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain(ownerId);
  });

  it('lists active plans in configured order without internal fields', async (ctx) => {
    if (!available) return ctx.skip();
    const first = await createPlan(db);
    const second = await createPlan(db);
    const hidden = await createPlan(db);
    actors.planIds.push(first.id, second.id, hidden.id);
    await db.update(plans).set({ sortOrder: -2 }).where(eq(plans.id, first.id));
    await db.update(plans).set({ sortOrder: -1 }).where(eq(plans.id, second.id));
    await db.update(plans).set({ isActive: false }).where(eq(plans.id, hidden.id));
    const response = await call('GET', '/plans');
    expect(response.statusCode).toBe(200);
    expect(PlanListSchema.parse(response.json())).toEqual(response.json());
    const ids = response.json().map((plan: { id: string }) => plan.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(ids).not.toContain(hidden.id);
  });

  it('public products expose only the seven catalogue fields', async (ctx) => {
    if (!available) return ctx.skip();
    const [product] = await db.insert(products).values({
      sku: prefix, name: prefix, category: 'BALL', pricePaise: 10000, stockQty: 2,
    }).returning();
    productIds.push(product.id);
    const response = await call('GET', `/products?q=${prefix}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([{
      id: product.id, sku: prefix, name: prefix, category: 'BALL', imageUrl: null, pricePaise: 10000, inStock: true,
    }]);
    expect((await call('GET', '/products?limit=101')).statusCode).toBe(400);
  });

  it('creates an enquiry and notifies owner/front desk, without echoing PII or accepting elevated fields', async (ctx) => {
    if (!available) return ctx.skip();
    const input = enquiry();
    const response = await call('POST', '/enquiries', {
      ...input, source: 'WALK_IN', status: 'WON', assignedTo: memberId, memberId,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: expect.any(String), message: "Thanks, we'll be in touch within one working day." });
    expect(response.body).not.toContain(input.email);
    const [lead] = await db.select().from(leads).where(eq(leads.id, response.json().id));
    expect(lead).toMatchObject({ source: 'WEBSITE_ENQUIRY', status: 'NEW', memberId: null, assignedTo: null });
    const alerts = await db.select().from(notifications).where(and(
      eq(notifications.type, 'NEW_LEAD'), eq(notifications.link, `/crm/leads/${lead.id}`),
    ));
    expect(alerts.map((alert) => alert.userId)).toEqual(expect.arrayContaining([ownerId, deskId]));
    expect(alerts.map((alert) => alert.userId)).not.toContain(memberId);
  });

  it('rejects malformed enquiries and trials at the boundary', async (ctx) => {
    if (!available) return ctx.skip();
    for (const payload of [
      { name: prefix, message: 'hello' }, { ...enquiry(), name: ' ' },
      { ...enquiry(), email: 'bad' }, { ...enquiry(), interestedPlanId: 'bad' },
      { ...enquiry(), message: 'x'.repeat(2001) },
    ]) expect((await call('POST', '/enquiries', payload)).statusCode).toBe(400);
    expect((await call('POST', '/trial-bookings', { ...trial(8), courtId: 'bad' })).statusCode).toBe(400);
    expect((await call('POST', '/trial-bookings', { ...trial(8), startsAt: 'bad' })).statusCode).toBe(400);
  });

  it('links a trial booking and lead atomically, rejects repeat phone and taken slots without new leads', async (ctx) => {
    if (!available) return ctx.skip();
    const input = trial(8);
    const response = await call('POST', '/trial-bookings', input);
    expect(response.statusCode).toBe(201);
    const body = CreateTrialBookingResponseSchema.parse(response.json());
    expect(body.booking).toMatchObject({ kind: 'TRIAL', channel: 'WEBSITE_TRIAL', pricePaise: 19900, paymentStatus: 'UNPAID', member: null });
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, body.booking.id));
    expect(booking.leadId).toBe(body.leadId);
    const [lead] = await db.select().from(leads).where(eq(leads.id, body.leadId));
    expect(lead.source).toBe('WEBSITE_TRIAL');
    const before = await db.select({ id: leads.id }).from(leads).where(eq(leads.name, prefix));
    const duplicate = await call('POST', '/trial-bookings', trial(9, input.phone));
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('TRIAL_ALREADY_USED');
    const conflict = await call('POST', '/trial-bookings', trial(8));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('SLOT_TAKEN');
    expect(await db.select({ id: leads.id }).from(leads).where(eq(leads.name, prefix))).toEqual(before);
    expect(await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.courtId, courtId))).toHaveLength(1);
    const availability = await call('GET', `/availability?date=${booking.bookingDate}&courtTypeId=${typeId}`);
    expect(availability.statusCode).toBe(200);
    expect(availability.body).not.toContain(input.phone);
    expect(availability.body).not.toContain(input.email);
    expect(availability.body).not.toContain(prefix);
  });

  it('rolls back booking, lead and notifications when the transaction callback fails after lead creation', async (ctx) => {
    if (!available) return ctx.skip();
    const input = { ...trial(11), name: `${prefix}-rollback` };
    let failedLeadId: string | undefined;
    const original = CrmService.prototype.createLead;
    const spy = vi.spyOn(CrmService.prototype, 'createLead').mockImplementation(async function (...args) {
      const lead = await original.apply(this, args);
      failedLeadId = lead.id;
      throw new Error('Injected callback failure after lead insertion');
    });
    try {
      const response = await call('POST', '/trial-bookings', input);
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('Injected callback failure');
      expect(failedLeadId).toBeDefined();
      expect(await db.select().from(leads).where(eq(leads.id, failedLeadId!))).toHaveLength(0);
      expect(await db.select().from(notifications).where(eq(notifications.link, `/crm/leads/${failedLeadId}`))).toHaveLength(0);
      expect(await db.select().from(bookings).where(eq(bookings.guestPhone, input.phone))).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts five valid enquiries and creates no lead for the rate-limited sixth', async (ctx) => {
    if (!available) return ctx.skip();
    const address = `10.113.3.${++ip}`;
    const input = { ...enquiry(), name: `${prefix}-limited` };
    for (let n = 0; n < 5; n += 1) expect((await call('POST', '/enquiries', input, address)).statusCode).toBe(201);
    expect((await call('POST', '/enquiries', input, address)).statusCode).toBe(429);
    expect(await db.select().from(leads).where(eq(leads.name, input.name))).toHaveLength(5);
  });

  for (const path of ['/club', '/plans', '/products']) it(`limits GET ${path} to 30/minute/IP`, async (ctx) => {
    if (!available) return ctx.skip();
    const address = `10.113.1.${++ip}`;
    for (let n = 0; n < 30; n += 1) expect((await call('GET', path, undefined, address)).statusCode).toBe(200);
    expect((await call('GET', path, undefined, address)).statusCode).toBe(429);
  });

  for (const path of ['/enquiries', '/trial-bookings']) it(`rejects the sixth POST ${path} and isolates limits per IP`, async (ctx) => {
    if (!available) return ctx.skip();
    const address = `10.113.2.${++ip}`;
    const payload = path === '/enquiries' ? enquiry() : trial(10);
    // Invalid bodies still consume the abuse budget, without creating fixtures.
    const invalid = { ...payload, name: '' };
    for (let n = 0; n < 5; n += 1) expect((await call('POST', path, invalid, address)).statusCode).toBe(400);
    const response = await call('POST', path, payload, address);
    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe('RATE_LIMIT_EXCEEDED');
    expect(response.json().requestId).toBe(response.headers['x-request-id']);
    expect((await call('POST', path, invalid)).statusCode).toBe(400);
  });

  it('documents all public endpoints without cookie authentication', async (ctx) => {
    if (!available) return ctx.skip();
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(response.statusCode).toBe(200);
    for (const path of ['club', 'plans', 'products', 'enquiries', 'trial-bookings']) {
      const route = response.json().paths[`/api/v1/public/${path}`];
      expect(route).toBeDefined();
      expect((route.get ?? route.post).security ?? []).toEqual([]);
    }
  });
});
