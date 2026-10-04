import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gte, inArray, like, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { businessClients, getDb, invoices, members, payments, systemAuditLogs, systemSettings, users } from '@packages/db';
import {
  BusinessClientPageSchema,
  BusinessClientSchema,
  InvoiceDetailSchema,
  InvoicePageSchema,
  InvoiceSchema,
  LedgerPaymentPageSchema,
  PayInvoiceResponseSchema,
  TaxSummarySchema,
} from '@packages/validation';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { createMember } from '../../../apps/api/src/test-support/court-fixtures.js';
import { makeActor, nextIp, rolesSeeded, type Actor } from '../../../apps/api/src/test-support/role-actors.js';
import { inclusiveTaxPaise, parseTaxRates } from '../../../apps/api/src/services/report.service.js';

const API = '/api/v1';
const line = (description: string, qty: number, unitPricePaise: number) => ({ description, qty, unitPricePaise });

describe('Invoices, business clients, ledger and tax (S-04)', () => {
  let app: FastifyInstance;
  let ready = false;
  const db = getDb();
  const userIds: string[] = [];
  const memberIds: string[] = [];
  const clientIds: string[] = [];
  const invoiceIds: string[] = [];
  let owner: Actor;
  let desk: Actor;
  let bar: Actor;
  let member: Actor;
  let otherMember: Actor;
  let memberId: string;
  let otherMemberId: string;
  let clientId: string;
  let invoiceRate = 1800;

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, actor: Actor | null, payload?: object) =>
    app.inject({ method, url: `${API}${url}`, remoteAddress: nextIp(), headers: actor ? { cookie: actor.cookie } : undefined, payload });

  async function draft(extra: Record<string, unknown> = {}, lines = [line('Court hire', 2, 50_000)]) {
    const res = await call('POST', '/invoices', desk, { memberId, lines, ...extra });
    expect(res.statusCode, res.body).toBe(201);
    const invoice = InvoiceSchema.parse(res.json());
    invoiceIds.push(invoice.id);
    return invoice;
  }
  async function sent(extra: Record<string, unknown> = {}, lines?: ReturnType<typeof line>[]) {
    const invoice = await draft(extra, lines);
    expect((await call('POST', `/invoices/${invoice.id}/send`, desk)).statusCode).toBe(200);
    return invoice;
  }

  /** Runs every step even when an earlier one fails, so one broken row cannot strand the rest. */
  async function removeAll(steps: Array<() => Promise<unknown>>) {
    const failures: unknown[] = [];
    for (const step of steps) {
      try { await step(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw failures[0];
  }

  /** Deletes what an earlier, interrupted run of this file left behind. Only rows carrying this file's markers. */
  async function purgeStale() {
    const staleMembers = await db.select({ id: members.id }).from(members).where(like(members.fullName, 'S04 %'));
    const ids = staleMembers.map((m) => m.id);
    await removeAll([
      async () => {
        const staleInvoices = ids.length ? await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.memberId, ids)) : [];
        const invoiceIds2 = staleInvoices.map((i) => i.id);
        if (invoiceIds2.length) {
          await db.delete(payments).where(inArray(payments.sourceId, invoiceIds2));
          await db.delete(invoices).where(inArray(invoices.id, invoiceIds2));
        }
      },
      () => db.delete(payments).where(and(gte(payments.paidAt, new Date('2033-05-01T00:00:00Z')), lt(payments.paidAt, new Date('2033-07-01T00:00:00Z')))),
      () => db.delete(businessClients).where(like(businessClients.companyName, 'S04 %')),
      async () => { if (ids.length) await db.delete(members).where(inArray(members.id, ids)); },
    ]);
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ready = (await isDatabaseAvailable()) && (await rolesSeeded());
    if (!ready) return;
    await purgeStale();
    // Track each actor as soon as it exists, so a failure part-way still cleans up what was made.
    const roles = ['OWNER', 'FRONT_DESK', 'BAR_STAFF', 'MEMBER', 'MEMBER'] as const;
    const settled = await Promise.allSettled(roles.map((role) => makeActor(app, role, 's04')));
    for (const result of settled) if (result.status === 'fulfilled') userIds.push(result.value.id);
    const failed = settled.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    [owner, desk, bar, member, otherMember] = settled.map((r) => (r as PromiseFulfilledResult<Actor>).value) as [Actor, Actor, Actor, Actor, Actor];
    memberId = (await createMember(db, { userId: member.id, fullName: 'S04 Member' })).id;
    otherMemberId = (await createMember(db, { userId: otherMember.id, fullName: 'S04 Other' })).id;
    memberIds.push(memberId, otherMemberId);
    const [client] = await db.insert(businessClients).values({ companyName: 'S04 Acme Corp', contactName: 'Priya', email: 'acme-s04@example.com' }).returning();
    clientId = client.id;
    clientIds.push(clientId);
    const [rates] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'tax.rates')).limit(1);
    invoiceRate = parseTaxRates(rates?.value).INVOICE;
  }, 60_000);

  afterAll(async () => {
    try {
      if (ready) {
        const invoiceList = invoiceIds.filter(Boolean);
        await removeAll([
          async () => {
            if (invoiceList.length) {
              await db.delete(payments).where(inArray(payments.sourceId, invoiceList));
              await db.delete(invoices).where(inArray(invoices.id, invoiceList)); // lines cascade
            }
          },
          () => db.delete(payments).where(and(gte(payments.paidAt, new Date('2033-05-01T00:00:00Z')), lt(payments.paidAt, new Date('2033-07-01T00:00:00Z')))),
          async () => { if (clientIds.length) await db.delete(businessClients).where(inArray(businessClients.id, clientIds)); },
          async () => { if (memberIds.length) await db.delete(members).where(inArray(members.id, memberIds)); },
          async () => { if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); },
        ]);
      }
    } finally {
      await app.close();
    }
  });

  // ================================================================ access control
  describe('authentication and authorization', () => {
    it('401 on every finance route without a session', async () => {
      const id = randomUUID();
      const calls: Array<['GET' | 'POST' | 'PUT', string, object?]> = [
        // Bodies are valid on purpose: schema validation runs before the auth hook.
        ['GET', '/invoices'], ['POST', '/invoices', { memberId: id, lines: [line('x', 1, 1)] }], ['GET', `/invoices/${id}`], ['POST', `/invoices/${id}/send`],
        ['POST', `/invoices/${id}/pay`, { method: 'CASH' }], ['POST', `/invoices/${id}/void`, { reason: 'x' }],
        ['GET', '/business-clients'], ['POST', '/business-clients', { companyName: 'x' }], ['PUT', `/business-clients/${id}`, {}],
        ['GET', '/payments'], ['GET', '/finance/tax-summary?from=2033-05-01&to=2033-05-31'],
      ];
      for (const [method, url, payload] of calls) expect((await call(method, url, null, payload)).statusCode, `${method} ${url}`).toBe(401);
    });

    it('adversarial: bar staff and members are refused every staff finance route', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await draft();
      const calls: Array<['GET' | 'POST' | 'PUT', string, object?]> = [
        ['GET', '/invoices'], ['POST', '/invoices', { memberId, lines: [line('x', 1, 1)] }], ['POST', `/invoices/${invoice.id}/send`],
        ['POST', `/invoices/${invoice.id}/pay`, { method: 'CASH' }], ['POST', `/invoices/${invoice.id}/void`, { reason: 'x' }],
        ['GET', '/business-clients'], ['POST', '/business-clients', { companyName: 'x' }], ['PUT', `/business-clients/${clientId}`, { companyName: 'y' }],
        ['GET', '/payments'], ['GET', '/finance/tax-summary?from=2033-05-01&to=2033-05-31'],
      ];
      for (const actor of [bar, member]) for (const [method, url, payload] of calls) expect((await call(method, url, actor, payload)).statusCode, `${method} ${url}`).toBe(403);
      expect((await call('GET', `/invoices/${invoice.id}`, bar)).statusCode).toBe(403);
      const [row] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
      expect(row.status).toBe('DRAFT');
    });

    it('front desk can invoice and take payment but cannot void, read the ledger or the tax summary', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await sent();
      expect((await call('POST', `/invoices/${invoice.id}/void`, desk, { reason: 'x' })).statusCode).toBe(403);
      expect((await call('GET', '/payments', desk)).statusCode).toBe(403);
      expect((await call('GET', '/finance/tax-summary?from=2033-05-01&to=2033-05-31', desk)).statusCode).toBe(403);
      expect((await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CASH' })).statusCode).toBe(200);
    });
  });

  // ==================================================================== create
  describe('POST /invoices', () => {
    it('creates a DRAFT with computed totals, inclusive tax, an INV number and the default due date', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await draft({ issueDate: '2033-05-10', notes: 'Thanks' }, [line('Court hire', 2, 50_000), line('Racket string', 1, 25_050)]);
      expect(invoice).toMatchObject({
        status: 'DRAFT', issueDate: '2033-05-10', dueDate: '2033-05-25', subtotalPaise: 125_050, totalPaise: 125_050,
        paidPaise: 0, balancePaise: 125_050, notes: 'Thanks', billTo: { type: 'MEMBER', id: memberId, name: 'S04 Member' },
      });
      expect(invoice.taxPaise).toBe(inclusiveTaxPaise(125_050, invoiceRate));
      expect(invoice.invoiceNumber).toMatch(/^INV-2033-\d{4,}$/);
      expect(invoice.lines).toEqual([
        { description: 'Court hire', qty: 2, unitPricePaise: 50_000, lineTotalPaise: 100_000 },
        { description: 'Racket string', qty: 1, unitPricePaise: 25_050, lineTotalPaise: 25_050 },
      ]);
      const second = await draft();
      expect(second.invoiceNumber).not.toBe(invoice.invoiceNumber);
    });

    it('keeps the order the lines were sent in, even with many lines', async (ctx) => {
      if (!ready) return ctx.skip();
      const sent = Array.from({ length: 12 }, (_, i) => line(`Item ${String(i + 1).padStart(2, '0')}`, 1, 100 + i));
      const created = await draft({}, sent);
      expect(created.lines.map((l) => l.description)).toEqual(sent.map((l) => l.description));
      const read = InvoiceDetailSchema.parse((await call('GET', `/invoices/${created.id}`, owner)).json());
      expect(read.lines.map((l) => l.description)).toEqual(sent.map((l) => l.description));
    });

    it('bills a business client and 404s for an unknown member or client', async (ctx) => {
      if (!ready) return ctx.skip();
      const res = await call('POST', '/invoices', owner, { businessClientId: clientId, lines: [line('Corporate day', 1, 1_000_000)] });
      expect(res.statusCode).toBe(201);
      invoiceIds.push(res.json().id);
      expect(res.json().billTo).toEqual({ type: 'BUSINESS_CLIENT', id: clientId, name: 'S04 Acme Corp' });
      expect((await call('POST', '/invoices', desk, { memberId: randomUUID(), lines: [line('x', 1, 1)] })).statusCode).toBe(404);
      expect((await call('POST', '/invoices', desk, { businessClientId: randomUUID(), lines: [line('x', 1, 1)] })).statusCode).toBe(404);
    });

    it('400 for both or neither bill-to, bad lines, due before issue and malformed dates', async (ctx) => {
      if (!ready) return ctx.skip();
      const ok = [line('x', 1, 100)];
      const bad: object[] = [
        { lines: ok }, { memberId, businessClientId: clientId, lines: ok }, { memberId, lines: [] },
        { memberId, lines: Array.from({ length: 51 }, () => line('x', 1, 1)) },
        { memberId, lines: [line('x', 0, 100)] }, { memberId, lines: [line('x', 1, -1)] }, { memberId, lines: [line('x', 1.5, 100)] },
        { memberId, lines: [line(' ', 1, 100)] }, { memberId, lines: ok, issueDate: '2033-05-10', dueDate: '2033-05-09' },
        { memberId, lines: ok, issueDate: '10/05/2033' }, { memberId: 'nope', lines: ok },
      ];
      for (const body of bad) expect((await call('POST', '/invoices', desk, body)).statusCode, JSON.stringify(body)).toBe(400);
    });

    it('422 when the total is absurdly large', async (ctx) => {
      if (!ready) return ctx.skip();
      const res = await call('POST', '/invoices', desk, { memberId, lines: [line('Gold plated court', 20, 1_900_000_000)] });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('AMOUNT_TOO_LARGE');
    });
  });

  // ============================================================== send, pay, void
  describe('send, pay and void', () => {
    it('send: DRAFT to SENT, 409 when repeated, 404 when unknown', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await draft();
      const res = await call('POST', `/invoices/${invoice.id}/send`, desk);
      expect(InvoiceSchema.parse(res.json()).status).toBe('SENT');
      const again = await call('POST', `/invoices/${invoice.id}/send`, desk);
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('INVALID_INVOICE_STATE');
      expect((await call('POST', `/invoices/${randomUUID()}/send`, desk)).statusCode).toBe(404);
    });

    it('pay: a DRAFT cannot be paid; partial then final payment settles it and writes the ledger', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await draft({}, [line('Coaching', 1, 100_000)]);
      const early = await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CASH' });
      expect(early.statusCode).toBe(409);
      expect(early.json().code).toBe('INVOICE_NOT_SENT');
      await call('POST', `/invoices/${invoice.id}/send`, desk);

      const part = await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'UPI', amountPaise: 40_000, reference: 'UPI-S04' });
      expect(part.statusCode).toBe(200);
      const partial = PayInvoiceResponseSchema.parse(part.json());
      expect(partial.invoice).toMatchObject({ status: 'SENT', paidPaise: 40_000, balancePaise: 60_000 });
      expect(partial.payment).toMatchObject({ amountPaise: 40_000, method: 'UPI' });

      const over = await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CASH', amountPaise: 60_001 });
      expect(over.statusCode).toBe(422);
      expect(over.json().code).toBe('AMOUNT_EXCEEDS_BALANCE');

      const rest = PayInvoiceResponseSchema.parse((await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CARD' })).json());
      expect(rest.invoice).toMatchObject({ status: 'PAID', paidPaise: 100_000, balancePaise: 0 });
      expect(rest.payment.amountPaise).toBe(60_000);

      const detail = InvoiceDetailSchema.parse((await call('GET', `/invoices/${invoice.id}`, owner)).json());
      expect(detail.payments.map((p) => p.amountPaise)).toEqual([40_000, 60_000]);
      const ledger = await db.select().from(payments).where(eq(payments.sourceId, invoice.id));
      expect(ledger.map((p) => [p.source, p.kind, p.amountPaise, p.receivedBy])).toEqual(expect.arrayContaining([['INVOICE', 'PAYMENT', 40_000, desk.id], ['INVOICE', 'PAYMENT', 60_000, desk.id]]));
      expect(ledger.find((p) => p.reference === 'UPI-S04')).toBeTruthy();
      expect(ledger.find((p) => p.amountPaise === 40_000)?.memberId).toBe(memberId);

      const again = await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CASH' });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('ALREADY_PAID');
    });

    it('400 for a zero or fractional amount, an unknown method; 404 for an unknown invoice', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await sent();
      for (const bad of [{ method: 'CASH', amountPaise: 0 }, { method: 'CASH', amountPaise: 10.5 }, { method: 'CASH', amountPaise: -5 }, { method: 'BITCOIN' }, {}]) {
        expect((await call('POST', `/invoices/${invoice.id}/pay`, desk, bad)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect((await call('POST', `/invoices/${randomUUID()}/pay`, desk, { method: 'CASH' })).statusCode).toBe(404);
      expect(await db.select().from(payments).where(eq(payments.sourceId, invoice.id))).toHaveLength(0);
    });

    it('adversarial: five concurrent full payments settle the invoice exactly once', async (ctx) => {
      if (!ready) return ctx.skip();
      const invoice = await sent({}, [line('Tournament entry', 1, 250_000)]);
      const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CASH' })));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
      const ledger = await db.select().from(payments).where(eq(payments.sourceId, invoice.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0].amountPaise).toBe(250_000);
    });

    it('void: owner voids an unpaid invoice with an audit entry; paid, part-paid and void invoices refuse', async (ctx) => {
      if (!ready) return ctx.skip();
      const unpaid = await sent();
      expect((await call('POST', `/invoices/${unpaid.id}/void`, owner, {})).statusCode).toBe(400);
      expect((await call('POST', `/invoices/${unpaid.id}/void`, owner, { reason: ' ' })).statusCode).toBe(400);
      const voided = await call('POST', `/invoices/${unpaid.id}/void`, owner, { reason: 'Issued by mistake' });
      expect(InvoiceSchema.parse(voided.json())).toMatchObject({ status: 'VOID', balancePaise: 0 });
      const audit = await db.select().from(systemAuditLogs).where(eq(systemAuditLogs.action, 'INVOICE_VOIDED'));
      expect(audit.some((row) => (row.details as { reason?: string } | null)?.reason === 'Issued by mistake')).toBe(true);
      const twice = await call('POST', `/invoices/${unpaid.id}/void`, owner, { reason: 'again' });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().code).toBe('ALREADY_VOID');
      const payVoid = await call('POST', `/invoices/${unpaid.id}/pay`, desk, { method: 'CASH' });
      expect(payVoid.json().code).toBe('INVOICE_VOID');

      const partPaid = await sent({}, [line('Camp', 1, 100_000)]);
      await call('POST', `/invoices/${partPaid.id}/pay`, desk, { method: 'CASH', amountPaise: 1_000 });
      expect((await call('POST', `/invoices/${partPaid.id}/void`, owner, { reason: 'x' })).json().code).toBe('INVOICE_HAS_PAYMENTS');
      const paid = await sent({}, [line('Camp', 1, 1_000)]);
      await call('POST', `/invoices/${paid.id}/pay`, desk, { method: 'CASH' });
      expect((await call('POST', `/invoices/${paid.id}/void`, owner, { reason: 'x' })).json().code).toBe('INVOICE_HAS_PAYMENTS');
      expect((await call('POST', `/invoices/${randomUUID()}/void`, owner, { reason: 'x' })).statusCode).toBe(404);
    });
  });

  // ================================================================ read access
  describe('GET /invoices/:id and GET /invoices', () => {
    it('a member reads their own invoice but another member\'s looks missing (404)', async (ctx) => {
      if (!ready) return ctx.skip();
      const mine = await sent();
      const own = await call('GET', `/invoices/${mine.id}`, member);
      expect(own.statusCode).toBe(200);
      expect(InvoiceDetailSchema.parse(own.json()).id).toBe(mine.id);
      const other = await call('GET', `/invoices/${mine.id}`, otherMember);
      expect(other.statusCode).toBe(404);
      expect(other.body).not.toContain('S04 Member');
      const forClient = await call('POST', '/invoices', desk, { businessClientId: clientId, lines: [line('x', 1, 100)] });
      invoiceIds.push(forClient.json().id);
      expect((await call('GET', `/invoices/${forClient.json().id}`, member)).statusCode).toBe(404);
      expect((await call('GET', `/invoices/${randomUUID()}`, member)).statusCode).toBe(404);
      expect((await call('GET', '/invoices/not-a-uuid', desk)).statusCode).toBe(400);
    });

    it('lists with status, member and overdue filters and paginates', async (ctx) => {
      if (!ready) return ctx.skip();
      // The due date must be in the real past for "overdue"; the far future is never overdue.
      const overdue = await sent({ memberId: otherMemberId, issueDate: '2020-05-01', dueDate: '2020-05-02' });
      const future = await sent({ memberId: otherMemberId, issueDate: '2020-05-01', dueDate: '2099-01-01' });
      const draftOne = await draft({ memberId: otherMemberId });
      const byMember = InvoicePageSchema.parse((await call('GET', `/invoices?memberId=${otherMemberId}&limit=100`, desk)).json());
      expect(byMember.data.map((i) => i.id)).toEqual(expect.arrayContaining([overdue.id, future.id, draftOne.id]));
      expect(byMember.data.every((i) => i.billTo.id === otherMemberId)).toBe(true);
      const late = InvoicePageSchema.parse((await call('GET', `/invoices?memberId=${otherMemberId}&overdue=true`, desk)).json());
      expect(late.data.map((i) => i.id)).toEqual([overdue.id]);
      const notLate = InvoicePageSchema.parse((await call('GET', `/invoices?memberId=${otherMemberId}&overdue=false&limit=100`, desk)).json());
      expect(notLate.data.map((i) => i.id)).toEqual(expect.arrayContaining([future.id, draftOne.id]));
      expect(notLate.data.map((i) => i.id)).not.toContain(overdue.id);
      const drafts = InvoicePageSchema.parse((await call('GET', `/invoices?memberId=${otherMemberId}&status=DRAFT`, desk)).json());
      expect(drafts.data.every((i) => i.status === 'DRAFT')).toBe(true);
      const paged = InvoicePageSchema.parse((await call('GET', `/invoices?memberId=${otherMemberId}&limit=2&page=2`, desk)).json());
      expect(paged.meta).toMatchObject({ page: 2, limit: 2, totalItems: 3, totalPages: 2, hasPrevPage: true, hasNextPage: false });
      expect(paged.data).toHaveLength(1);
      for (const bad of ['status=PAID2', 'overdue=maybe', 'from=yesterday', 'limit=1000', 'memberId=x']) expect((await call('GET', `/invoices?${bad}`, desk)).statusCode, bad).toBe(400);
    });
  });

  // =========================================================== business clients
  describe('business clients', () => {
    it('creates, searches and updates a client; open balance follows sent invoices and payments', async (ctx) => {
      if (!ready) return ctx.skip();
      const created = await call('POST', '/business-clients', desk, { companyName: 'S04 Zephyr Unique', contactName: 'Ravi', email: ' Ops@ZEPHYR-S04.example ', gstin: '29ABCDE1234F1Z5' });
      expect(created.statusCode).toBe(201);
      const client = BusinessClientSchema.parse(created.json());
      clientIds.push(client.id);
      expect(client).toMatchObject({ companyName: 'S04 Zephyr Unique', email: 'ops@zephyr-s04.example', openBalancePaise: 0 });

      const found = BusinessClientPageSchema.parse((await call('GET', '/business-clients?q=zephyr', desk)).json());
      expect(found.data.map((c) => c.id)).toEqual([client.id]);

      const inv = await call('POST', '/invoices', desk, { businessClientId: client.id, lines: [line('Event', 1, 500_000)] });
      invoiceIds.push(inv.json().id);
      expect(BusinessClientPageSchema.parse((await call('GET', '/business-clients?q=zephyr', desk)).json()).data[0].openBalancePaise).toBe(0); // drafts are not owed yet
      await call('POST', `/invoices/${inv.json().id}/send`, desk);
      expect(BusinessClientPageSchema.parse((await call('GET', '/business-clients?q=zephyr', desk)).json()).data[0].openBalancePaise).toBe(500_000);
      await call('POST', `/invoices/${inv.json().id}/pay`, desk, { method: 'CASH', amountPaise: 200_000 });
      expect(BusinessClientPageSchema.parse((await call('GET', '/business-clients?q=zephyr', desk)).json()).data[0].openBalancePaise).toBe(300_000);

      const updated = await call('PUT', `/business-clients/${client.id}`, desk, { phone: '+919811122233', billingAddress: '1 Court Road' });
      expect(BusinessClientSchema.parse(updated.json())).toMatchObject({ phone: '+919811122233', billingAddress: '1 Court Road', companyName: 'S04 Zephyr Unique', openBalancePaise: 300_000 });
      expect((await call('PUT', `/business-clients/${client.id}`, desk, {})).statusCode).toBe(200);
    });

    it('400 for a missing company name or bad email; 404 when updating a missing client', async (ctx) => {
      if (!ready) return ctx.skip();
      expect((await call('POST', '/business-clients', desk, { contactName: 'x' })).statusCode).toBe(400);
      expect((await call('POST', '/business-clients', desk, { companyName: ' ' })).statusCode).toBe(400);
      expect((await call('POST', '/business-clients', desk, { companyName: 'X', email: 'nope' })).statusCode).toBe(400);
      expect((await call('PUT', `/business-clients/${clientId}`, desk, { email: 'nope' })).statusCode).toBe(400);
      expect((await call('PUT', `/business-clients/${randomUUID()}`, desk, { companyName: 'Y' })).statusCode).toBe(404);
    });
  });

  // ============================================================= ledger and tax
  describe('GET /payments and GET /finance/tax-summary', () => {
    let seeded = false;
    // Seeded once: both ledger tests read the same fixed 2033 rows, and a second insert would double the totals.
    const seedLedger = async () => {
      if (seeded) return;
      seeded = true;
      const at = (iso: string) => new Date(`${iso}+05:30`);
      await db.insert(payments).values([
        { source: 'COURT', kind: 'PAYMENT', amountPaise: 118_000, method: 'UPI', paidAt: at('2033-05-10T10:00:00') },
        { source: 'COURT', kind: 'REFUND', amountPaise: -18_000, method: 'UPI', paidAt: at('2033-05-11T10:00:00') },
        { source: 'BAR', kind: 'PAYMENT', amountPaise: 52_500, method: 'CASH', paidAt: at('2033-05-12T23:30:00') },
        { source: 'SHOP', kind: 'PAYMENT', amountPaise: 11_800, method: 'CARD', paidAt: at('2033-06-01T00:10:00') },
      ]);
    };

    it('lists the ledger for the owner with filters, club-day boundaries and receivedBy', async (ctx) => {
      if (!ready) return ctx.skip();
      await seedLedger();
      const all = LedgerPaymentPageSchema.parse((await call('GET', '/payments?from=2033-05-10&to=2033-05-12&limit=100', owner)).json());
      expect(all.data.map((p) => p.amountPaise).sort((a, b) => a - b)).toEqual([-18_000, 52_500, 118_000]);
      expect(all.data.find((p) => p.source === 'BAR')).toMatchObject({ method: 'CASH', kind: 'PAYMENT', receivedBy: null, shiftId: null });
      const refunds = LedgerPaymentPageSchema.parse((await call('GET', '/payments?from=2033-05-01&to=2033-05-31&kind=REFUND', owner)).json());
      expect(refunds.data.every((p) => p.kind === 'REFUND' && p.amountPaise < 0)).toBe(true);
      const upi = LedgerPaymentPageSchema.parse((await call('GET', '/payments?from=2033-05-01&to=2033-05-31&method=UPI&source=COURT', owner)).json());
      expect(upi.meta.totalItems).toBe(2);
      const june = LedgerPaymentPageSchema.parse((await call('GET', '/payments?from=2033-06-01&to=2033-06-01', owner)).json());
      expect(june.data.map((p) => p.source)).toEqual(['SHOP']);
      const invoice = await sent();
      await call('POST', `/invoices/${invoice.id}/pay`, desk, { method: 'CASH' });
      const mine = LedgerPaymentPageSchema.parse((await call('GET', `/payments?source=INVOICE&limit=100`, owner)).json());
      const row = mine.data.find((p) => p.sourceId === invoice.id);
      expect(row?.receivedBy).toMatchObject({ id: desk.id });
      for (const bad of ['method=BITCOIN', 'from=soon', 'limit=0', 'page=0']) expect((await call('GET', `/payments?${bad}`, owner)).statusCode, bad).toBe(400);
    });

    it('tax summary: gross is net of refunds, tax is the inclusive portion per source and totals add up', async (ctx) => {
      if (!ready) return ctx.skip();
      await seedLedger();
      const res = await call('GET', '/finance/tax-summary?from=2033-05-10&to=2033-05-12', owner);
      expect(res.statusCode).toBe(200);
      const summary = TaxSummarySchema.parse(res.json());
      const [rates] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'tax.rates')).limit(1);
      const configured = parseTaxRates(rates?.value);
      const court = summary.rows.find((r) => r.source === 'COURT')!;
      expect(court).toMatchObject({ grossPaise: 100_000, taxRateBp: configured.COURT, taxPaise: inclusiveTaxPaise(100_000, configured.COURT) });
      expect(court.netPaise).toBe(court.grossPaise - court.taxPaise);
      expect(summary.rows.find((r) => r.source === 'BAR')).toMatchObject({ grossPaise: 52_500, taxRateBp: configured.BAR });
      expect(summary.rows.find((r) => r.source === 'SHOP')).toBeUndefined(); // 1 June is outside the range
      const gross = summary.rows.reduce((sum, r) => sum + r.grossPaise, 0);
      expect(summary.totals).toEqual({ grossPaise: gross, taxPaise: summary.rows.reduce((s, r) => s + r.taxPaise, 0), netPaise: summary.rows.reduce((s, r) => s + r.netPaise, 0) });
      expect(summary.note).toBe('Simplified: inclusive rates per source');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('400 for missing or reversed dates and a range longer than a year', async (ctx) => {
      if (!ready) return ctx.skip();
      for (const q of ['', '?from=2033-05-01', '?to=2033-05-01', '?from=2033-05-10&to=2033-05-01', '?from=2031-01-01&to=2033-01-01', '?from=x&to=y']) {
        expect((await call('GET', `/finance/tax-summary${q}`, owner)).statusCode, q).toBe(400);
      }
    });
  });
});
