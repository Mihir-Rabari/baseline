import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, like, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  barTables,
  kitchenTickets,
  memberships,
  menuItems,
  payments,
  systemAuditLogs,
  tabItems,
  tabs,
} from '@packages/db';
import {
  BarEarningsSchema,
  SendTabResponseSchema,
  SettleTabResponseSchema,
  TabSchema,
  TabSummaryPageSchema,
  TicketListSchema,
} from '@packages/validation';
import { IamConfig } from '@packages/config';
import { buildApp } from './app.js';
import { addDays, clubDateOf } from './lib/club-date.js';
import { PaymentService } from './services/payment.service.js';
import { discountedLine } from './services/bar.service.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { MembersFixtures, type Actor } from './test-support/members-fixtures.js';

const TZ = 'Asia/Kolkata';
const PREFIX = `M12-${randomUUID().slice(0, 8)}`;

describe('discountedLine (BR-05 rounding)', () => {
  it.each([
    [40000, 2, 5, 76000],
    [40000, 1, 0, 40000],
    [33300, 3, 5, 94905],
    [999, 1, 5, 949],
    [1, 1, 50, 1],
    [40000, 1, 100, 0],
  ])('unit %i x %i at %i%% = %i', (unit, qty, pct, expected) => {
    expect(discountedLine(unit, qty, pct)).toBe(expected);
  });
});

describe('Bar POS (M-12)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const fx = new MembersFixtures();
  const db = fx.db;
  let bar: Actor;
  let owner: Actor;
  let desk: Actor;
  let memberUser: Actor;
  let planId: string;
  let memberId: string;
  let drink: { id: string; pricePaise: number };
  let food: { id: string; pricePaise: number };
  let plain: { id: string; pricePaise: number };
  const tableIds: string[] = [];
  const tabIds: string[] = [];

  const as = (a: Actor) => ({ cookie: a.cookie });

  async function table(): Promise<string> {
    const [row] = await db.insert(barTables).values({ name: `${PREFIX}-${tableIds.length}` }).returning({ id: barTables.id });
    tableIds.push(row.id);
    return row.id;
  }

  async function openTab(payload: Record<string, unknown>, actor = bar) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/bar/tabs', headers: as(actor), payload });
    if (res.statusCode === 201) tabIds.push(res.json().id);
    return res;
  }

  async function guestTab(): Promise<string> {
    const res = await openTab({ guestName: 'Walk-in' });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  const addItem = (tabId: string, menuItemId: string, qty = 1, actor = bar) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/bar/tabs/${tabId}/items`,
      headers: as(actor),
      payload: { menuItemId, qty },
    });

  const settle = (tabId: string, payload: unknown, actor = bar) =>
    app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/settle`, headers: as(actor), payload: payload as object });

  const send = (tabId: string, actor = bar) =>
    app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/send`, headers: as(actor) });

  const setTicket = (ticketId: string, status: string, actor = bar) =>
    app.inject({ method: 'PATCH', url: `/api/v1/bar/tickets/${ticketId}/status`, headers: as(actor), payload: { status } });

  const earnings = async (date?: string, actor = owner) =>
    app.inject({ method: 'GET', url: `/api/v1/bar/earnings${date ? `?date=${date}` : ''}`, headers: as(actor) });

  async function createMenu(actor: Actor, body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/v1/bar/menu', headers: as(actor), payload: body });
  }

  beforeAll(async () => {
    app = buildApp();
    MembersFixtures.spreadClientIps(app);
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;

    bar = await fx.actor(app, 'BAR_STAFF');
    owner = await fx.actor(app, 'OWNER');
    desk = await fx.actor(app, 'FRONT_DESK');
    memberUser = await fx.actor(app, 'MEMBER');

    const plan = await fx.plan({ barDiscountPct: 5 });
    planId = plan.id;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/members',
      headers: as(desk),
      payload: { fullName: 'M12 Member', phone: MembersFixtures.phone(), planId, paymentMethod: 'UPI' },
    });
    expect(reg.statusCode).toBe(201);
    memberId = reg.json().member.id;
    fx.memberIds.push(memberId);

    const mk = async (name: string, station: string, pricePaise: number, discountable = true) => {
      const res = await createMenu(owner, { name: `${PREFIX} ${name}`, category: 'DRINK', station, pricePaise, discountable });
      expect(res.statusCode).toBe(201);
      return { id: res.json().id as string, pricePaise };
    };
    drink = await mk('Mojito', 'BAR', 40000);
    food = await mk('Nachos', 'KITCHEN', 30000);
    plain = await mk('Bottled water', 'BAR', 5000, false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (hasDatabase) {
      if (tabIds.length) {
        await db.delete(payments).where(inArray(payments.sourceId, tabIds));
        await db
          .delete(systemAuditLogs)
          .where(sql`${systemAuditLogs.details}->>'target' IN (${sql.join(tabIds.map((id) => sql`${id}`), sql`, `)})`);
        await db.delete(tabItems).where(inArray(tabItems.tabId, tabIds));
        await db.delete(kitchenTickets).where(inArray(kitchenTickets.tabId, tabIds));
        await db.delete(tabs).where(inArray(tabs.id, tabIds));
      }
      await db.delete(menuItems).where(like(menuItems.name, `${PREFIX}%`));
      if (tableIds.length) await db.delete(barTables).where(inArray(barTables.id, tableIds));
      await fx.cleanup();
    }
    await app.close();
  });

  // ---------------------------------------------------------------- opening

  it('opens a guest tab and a member tab; only the member sees the plan bar discount', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const guest = await openTab({ guestName: 'Priya', tableId: await table() });
    expect(guest.statusCode).toBe(201);
    const guestTab = TabSchema.parse(guest.json());
    expect(guestTab.status).toBe('OPEN');
    expect(guestTab.member).toBeNull();
    expect(guestTab.table?.name).toContain(PREFIX);

    const member = await openTab({ memberId });
    expect(member.statusCode).toBe(201);
    const memberTab = TabSchema.parse(member.json());
    expect(memberTab.member).toMatchObject({ id: memberId, barDiscountPct: 5 });

    const g = (await addItem(guestTab.id, drink.id, 2)).json();
    expect(g.items[0]).toMatchObject({ unitPricePaise: 40000, discountPct: 0, lineTotalPaise: 80000 });
    expect(g.totalPaise).toBe(80000);

    const m = (await addItem(memberTab.id, drink.id, 2)).json();
    expect(m.items[0]).toMatchObject({ discountPct: 5, lineTotalPaise: 76000 });
    expect(m).toMatchObject({ subtotalPaise: 80000, discountPaise: 4000, totalPaise: 76000 });
  });

  it('does not discount items marked non-discountable, and not for a lapsed membership', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tab = (await openTab({ memberId })).json();
    const res = await addItem(tab.id, plain.id, 1);
    expect(res.json().items[0]).toMatchObject({ discountPct: 0, lineTotalPaise: 5000 });

    // Lapse the membership: BR-07 says a lapsed member pays walk-in prices.
    const yesterday = addDays(clubDateOf(new Date(), TZ), -1);
    const [current] = await db.select().from(memberships).where(eq(memberships.memberId, memberId));
    await db.update(memberships).set({ endsOn: yesterday }).where(eq(memberships.id, current.id));
    try {
      const lapsed = await addItem(tab.id, drink.id, 1);
      expect(lapsed.json().items.at(-1)).toMatchObject({ discountPct: 0, lineTotalPaise: 40000 });
      expect(lapsed.json().member.barDiscountPct).toBe(0);
    } finally {
      await db.update(memberships).set({ endsOn: current.endsOn }).where(eq(memberships.id, current.id));
    }
  });

  it('keeps the discount and price snapshot when the menu price changes later', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const created = await createMenu(owner, { name: `${PREFIX} Snapshot`, category: 'SNACK', station: 'KITCHEN', pricePaise: 10000 });
    const itemId = created.json().id as string;
    const tab = (await openTab({ memberId })).json();
    await addItem(tab.id, itemId, 1);
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/bar/menu/${itemId}`,
      headers: as(owner),
      payload: { pricePaise: 99900 },
    });
    expect(put.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${tab.id}`, headers: as(bar) });
    expect(after.json().items[0]).toMatchObject({ unitPricePaise: 10000, lineTotalPaise: 9500 });
  });

  it('refuses a second open tab on the same table, including under a race', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tableId = await table();
    const first = await openTab({ guestName: 'A', tableId });
    expect(first.statusCode).toBe(201);
    const second = await openTab({ guestName: 'B', tableId });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('TABLE_OCCUPIED');

    const raceTable = await table();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => openTab({ guestName: `R${i}`, tableId: raceTable })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409 && r.json().code === 'TABLE_OCCUPIED')).toHaveLength(5);
  });

  it('frees the table once the tab is settled', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tableId = await table();
    const tab = (await openTab({ guestName: 'Cycle', tableId })).json();
    await addItem(tab.id, drink.id);
    expect((await settle(tab.id, { payments: [{ method: 'CASH' }] })).statusCode).toBe(200);
    expect((await openTab({ guestName: 'Next', tableId })).statusCode).toBe(201);
  });

  it('lists tables with their open tab', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tableId = await table();
    const tab = (await openTab({ guestName: 'On table', tableId })).json();
    await addItem(tab.id, drink.id, 1);
    const res = await app.inject({ method: 'GET', url: '/api/v1/bar/tables', headers: as(bar) });
    expect(res.statusCode).toBe(200);
    const row = res.json().find((t: { id: string }) => t.id === tableId);
    expect(row).toMatchObject({ status: 'OCCUPIED', openTab: { id: tab.id, label: 'On table', totalPaise: 40000 } });
  });

  // -------------------------------------------------------------- validation

  it('validates request bodies (400) and unknown records (404)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const noHolder = await openTab({});
    expect(noHolder.statusCode).toBe(400);
    expect(noHolder.json().requestId).toBeTruthy();

    const tabId = await guestTab();
    for (const payload of [{ menuItemId: drink.id, qty: 0 }, { menuItemId: drink.id, qty: 21 }, { menuItemId: 'nope', qty: 1 }]) {
      const res = await app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/items`, headers: as(bar), payload });
      expect(res.statusCode).toBe(400);
    }
    expect((await addItem(tabId, randomUUID())).statusCode).toBe(404);
    expect((await addItem(randomUUID(), drink.id)).statusCode).toBe(404);
    expect((await openTab({ memberId: randomUUID() })).statusCode).toBe(404);
    expect((await openTab({ guestName: 'X', tableId: randomUUID() })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${randomUUID()}`, headers: as(bar) })).statusCode
    ).toBe(404);
    expect((await createMenu(owner, { name: 'x', category: 'WINE', station: 'BAR', pricePaise: 100 })).statusCode).toBe(400);
    expect((await createMenu(owner, { name: 'x', category: 'DRINK', station: 'BAR', pricePaise: 0 })).statusCode).toBe(400);
  });

  it('refuses an unavailable menu item and accepts it again once re-enabled', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const item = (await createMenu(owner, { name: `${PREFIX} Sold out`, category: 'FOOD', station: 'KITCHEN', pricePaise: 20000 })).json();
    const off = await app.inject({ method: 'PUT', url: `/api/v1/bar/menu/${item.id}`, headers: as(owner), payload: { isAvailable: false } });
    expect(off.json().isAvailable).toBe(false);
    const tabId = await guestTab();
    const refused = await addItem(tabId, item.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('ITEM_UNAVAILABLE');
    await app.inject({ method: 'PUT', url: `/api/v1/bar/menu/${item.id}`, headers: as(owner), payload: { isAvailable: true } });
    expect((await addItem(tabId, item.id)).statusCode).toBe(200);
  });

  it('filters the menu by category and returns 404 when editing a missing item', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await app.inject({ method: 'GET', url: '/api/v1/bar/menu?category=FOOD', headers: as(bar) });
    expect(res.statusCode).toBe(200);
    expect(res.json().every((m: { category: string }) => m.category === 'FOOD')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/v1/bar/menu?category=WINE', headers: as(bar) })).statusCode).toBe(400);
    const missing = await app.inject({ method: 'PUT', url: `/api/v1/bar/menu/${randomUUID()}`, headers: as(owner), payload: { name: 'x' } });
    expect(missing.statusCode).toBe(404);
  });

  // ------------------------------------------------------------- items, send

  it('removes a PENDING item for bar staff but only the owner may remove a SENT one', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    const added = (await addItem(tabId, drink.id, 1)).json();
    const keep = (await addItem(tabId, food.id, 1)).json();
    const [pendingItem, sentCandidate] = [added.items[0].id, keep.items[1].id];

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/bar/tabs/${tabId}/items/${pendingItem}`, headers: as(bar) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().items.find((i: { id: string }) => i.id === pendingItem).status).toBe('VOID');
    expect(removed.json().totalPaise).toBe(30000);

    const again = await app.inject({ method: 'DELETE', url: `/api/v1/bar/tabs/${tabId}/items/${pendingItem}`, headers: as(bar) });
    expect(again.statusCode).toBe(409);

    await send(tabId);
    const denied = await app.inject({ method: 'DELETE', url: `/api/v1/bar/tabs/${tabId}/items/${sentCandidate}`, headers: as(bar) });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({ method: 'DELETE', url: `/api/v1/bar/tabs/${tabId}/items/${sentCandidate}`, headers: as(owner) });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().totalPaise).toBe(0);

    const unknown = await app.inject({ method: 'DELETE', url: `/api/v1/bar/tabs/${tabId}/items/${randomUUID()}`, headers: as(bar) });
    expect(unknown.statusCode).toBe(404);
  });

  it('sends PENDING items grouped into one ticket per station and flags them SENT', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 2);
    await addItem(tabId, plain.id, 1);
    await addItem(tabId, food.id, 1);

    const res = await send(tabId);
    expect(res.statusCode).toBe(200);
    const body = SendTabResponseSchema.parse(res.json());
    expect(body.tickets).toHaveLength(2);
    expect(body.tickets.find((t) => t.station === 'BAR')?.itemCount).toBe(2);
    expect(body.tickets.find((t) => t.station === 'KITCHEN')?.itemCount).toBe(1);
    expect(body.tab.items.every((i) => i.status === 'SENT' && i.ticketId)).toBe(true);

    const empty = await send(tabId);
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('TAB_EMPTY');

    // A later round only sends what is new.
    await addItem(tabId, food.id, 1);
    const second = SendTabResponseSchema.parse((await send(tabId)).json());
    expect(second.tickets).toHaveLength(1);
    expect(second.tickets[0].itemCount).toBe(1);
  });

  it('refuses to send, add to or settle an empty tab', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    expect((await send(tabId)).json().code).toBe('TAB_EMPTY');
    const settled = await settle(tabId, { payments: [{ method: 'CASH' }] });
    expect(settled.statusCode).toBe(422);
    expect(settled.json().code).toBe('TAB_EMPTY');

    const item = (await addItem(tabId, drink.id)).json().items[0].id;
    await app.inject({ method: 'DELETE', url: `/api/v1/bar/tabs/${tabId}/items/${item}`, headers: as(bar) });
    expect((await settle(tabId, { payments: [{ method: 'CASH' }] })).json().code).toBe('TAB_EMPTY');
  });

  // ----------------------------------------------------------------- settle

  it('settles once, records one BAR ledger row and freezes the totals', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tab = (await openTab({ memberId })).json();
    await addItem(tab.id, drink.id, 2);

    const res = await settle(tab.id, { payments: [{ method: 'UPI', reference: 'UPI-1' }] });
    expect(res.statusCode).toBe(200);
    const body = SettleTabResponseSchema.parse(res.json());
    expect(body.tab.status).toBe('SETTLED');
    expect(body.receipt).toMatchObject({ totalPaise: 76000, discountPaise: 4000 });
    expect(body.payments).toEqual([expect.objectContaining({ method: 'UPI', amountPaise: 76000 })]);

    const rows = await db.select().from(payments).where(eq(payments.sourceId, tab.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'BAR', kind: 'PAYMENT', amountPaise: 76000, method: 'UPI', receivedBy: bar.id, memberId });

    // Totals are frozen: a later menu price change and a late add both leave the bill alone.
    await app.inject({ method: 'PUT', url: `/api/v1/bar/menu/${drink.id}`, headers: as(owner), payload: { pricePaise: 55500 } });
    await app.inject({ method: 'PUT', url: `/api/v1/bar/menu/${drink.id}`, headers: as(owner), payload: { pricePaise: 40000 } });
    const reread = await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${tab.id}`, headers: as(bar) });
    expect(reread.json()).toMatchObject({ status: 'SETTLED', totalPaise: 76000, subtotalPaise: 80000, discountPaise: 4000 });

    const late = await addItem(tab.id, drink.id);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('TAB_NOT_OPEN');
  });

  it('returns ALREADY_SETTLED on a second settle, also when requests race', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 1);
    expect((await settle(tabId, { payments: [{ method: 'CASH' }] })).statusCode).toBe(200);
    const again = await settle(tabId, { payments: [{ method: 'CASH' }] });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_SETTLED');

    const raced = await guestTab();
    await addItem(raced, drink.id, 1);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => settle(raced, { payments: [{ method: 'CARD' }] }))
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409 && r.json().code === 'ALREADY_SETTLED')).toHaveLength(7);
    const rows = await db.select().from(payments).where(eq(payments.sourceId, raced));
    expect(rows).toHaveLength(1);
  });

  it('accepts a split payment that adds up exactly and rejects any other split', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 1); // 40000

    const wrongSum = await settle(tabId, { payments: [{ method: 'CASH', amountPaise: 10000 }, { method: 'UPI', amountPaise: 20000 }] });
    expect(wrongSum.statusCode).toBe(400);
    const missingAmount = await settle(tabId, { payments: [{ method: 'CASH', amountPaise: 10000 }, { method: 'UPI' }] });
    expect(missingAmount.statusCode).toBe(400);
    const wrongSingle = await settle(tabId, { payments: [{ method: 'CASH', amountPaise: 39999 }] });
    expect(wrongSingle.statusCode).toBe(400);
    expect((await settle(tabId, { payments: [] })).statusCode).toBe(400);
    expect((await settle(tabId, { payments: [{ method: 'BITCOIN' }] })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${tabId}`, headers: as(bar) })).json().status).toBe('OPEN');

    const ok = await settle(tabId, { payments: [{ method: 'CASH', amountPaise: 15000 }, { method: 'UPI', amountPaise: 25000 }] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().payments.map((p: { amountPaise: number }) => p.amountPaise).sort()).toEqual([15000, 25000]);
    const rows = await db.select().from(payments).where(eq(payments.sourceId, tabId));
    expect(rows.reduce((sum, r) => sum + r.amountPaise, 0)).toBe(40000);
  });

  it('rolls everything back when the ledger write fails (tab stays OPEN, nothing recorded)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 1);
    vi.spyOn(PaymentService.prototype, 'record').mockRejectedValueOnce(new Error('ledger down'));

    const failed = await settle(tabId, { payments: [{ method: 'CASH' }] });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().message).not.toContain('ledger down');

    const [row] = await db.select().from(tabs).where(eq(tabs.id, tabId));
    expect(row.status).toBe('OPEN');
    expect(row.totalPaise).toBeNull();
    expect(await db.select().from(payments).where(eq(payments.sourceId, tabId))).toHaveLength(0);
    expect((await settle(tabId, { payments: [{ method: 'CASH' }] })).statusCode).toBe(200);
  });

  // ------------------------------------------------------------ void & audit

  it('lets only the owner void an open tab, audits the reason and refuses a settled tab', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 1);
    await send(tabId);

    expect((await app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/void`, headers: as(bar), payload: { reason: 'oops' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/void`, headers: as(owner), payload: {} })).statusCode).toBe(400);

    const res = await app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/void`, headers: as(owner), payload: { reason: 'Guest left' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'VOID', totalPaise: 0 });
    expect(res.json().items.every((i: { status: string }) => i.status === 'VOID')).toBe(true);
    const tickets = await db.select().from(kitchenTickets).where(eq(kitchenTickets.tabId, tabId));
    expect(tickets.every((t) => t.status === 'CANCELLED')).toBe(true);

    const [audit] = await db.select().from(systemAuditLogs).where(sql`${systemAuditLogs.details}->>'target' = ${tabId}`);
    expect(audit).toMatchObject({ action: 'BAR_TAB_VOIDED', actor: owner.id });
    expect((audit.details as { reason: string }).reason).toBe('Guest left');

    expect((await settle(tabId, { payments: [{ method: 'CASH' }] })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${tabId}/void`, headers: as(owner), payload: { reason: 'again' } })).statusCode).toBe(409);

    const paid = await guestTab();
    await addItem(paid, drink.id, 1);
    await settle(paid, { payments: [{ method: 'CASH' }] });
    const settledVoid = await app.inject({ method: 'POST', url: `/api/v1/bar/tabs/${paid}/void`, headers: as(owner), payload: { reason: 'late' } });
    expect(settledVoid.statusCode).toBe(409);
    expect(settledVoid.json().code).toBe('ALREADY_SETTLED');
  });

  // ---------------------------------------------------------------- tickets

  it('walks a ticket NEW → PREPARING → READY → SERVED and refuses to skip or go back', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, food.id, 1);
    const ticket = (await send(tabId)).json().tickets[0];

    const skip = await setTicket(ticket.id, 'SERVED');
    expect(skip.statusCode).toBe(409);
    expect(skip.json().code).toBe('ORDER_STATE_INVALID');
    expect((await setTicket(ticket.id, 'READY')).json().code).toBe('ORDER_STATE_INVALID');
    expect((await setTicket(ticket.id, 'NEW')).statusCode).toBe(400);

    for (const status of ['PREPARING', 'READY', 'SERVED']) {
      const res = await setTicket(ticket.id, status);
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(status);
    }
    const back = await setTicket(ticket.id, 'PREPARING');
    expect(back.statusCode).toBe(409);
    expect((await setTicket(ticket.id, 'CANCELLED')).json().code).toBe('ORDER_STATE_INVALID');
    expect((await setTicket(randomUUID(), 'PREPARING')).statusCode).toBe(404);
  });

  it('lists active tickets oldest first with items, table and waiting time, and filters by station', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tableId = await table();
    const tab = (await openTab({ memberId, tableId })).json();
    await addItem(tab.id, drink.id, 2);
    await addItem(tab.id, food.id, 1);
    await send(tab.id);

    const res = await app.inject({ method: 'GET', url: '/api/v1/bar/tickets', headers: as(bar) });
    expect(res.statusCode).toBe(200);
    const all = TicketListSchema.parse(res.json());
    const mine = all.filter((t) => t.tab.id === tab.id);
    expect(mine).toHaveLength(2);
    expect(mine[0].tab.label).toBe('M12 Member');
    expect(mine[0].table?.name).toContain(PREFIX);
    expect(mine.every((t) => t.status === 'NEW' && t.minutesWaiting >= 0)).toBe(true);
    const times = all.map((t) => t.createdAt);
    expect([...times].sort()).toEqual(times);
    expect(new Set(all.map((t) => t.ticketNumber)).size).toBe(all.length);

    const barOnly = await app.inject({ method: 'GET', url: '/api/v1/bar/tickets?station=BAR', headers: as(bar) });
    expect(barOnly.json().every((t: { station: string }) => t.station === 'BAR')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/v1/bar/tickets?status=FLYING', headers: as(bar) })).statusCode).toBe(400);

    const first = mine.find((t) => t.station === 'KITCHEN')!;
    await setTicket(first.id, 'PREPARING');
    await setTicket(first.id, 'READY');
    await setTicket(first.id, 'SERVED');
    const gone = await app.inject({ method: 'GET', url: '/api/v1/bar/tickets', headers: as(bar) });
    expect(gone.json().some((t: { id: string }) => t.id === first.id)).toBe(false);
    const served = await app.inject({ method: 'GET', url: '/api/v1/bar/tickets?status=SERVED', headers: as(bar) });
    expect(served.json().some((t: { id: string }) => t.id === first.id)).toBe(true);
  });

  it('cancelling a ticket removes its items from the bill, and two racing moves cannot both win', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 1);
    await addItem(tabId, food.id, 1);
    const tickets = (await send(tabId)).json().tickets as Array<{ id: string; station: string }>;
    const kitchen = tickets.find((t) => t.station === 'KITCHEN')!;

    expect((await setTicket(kitchen.id, 'CANCELLED')).statusCode).toBe(200);
    const tab = (await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${tabId}`, headers: as(bar) })).json();
    expect(tab.totalPaise).toBe(40000);
    expect(tab.items.find((i: { menuItemId: string }) => i.menuItemId === food.id).status).toBe('VOID');

    const barTicket = tickets.find((t) => t.station === 'BAR')!;
    const race = await Promise.all([setTicket(barTicket.id, 'PREPARING'), setTicket(barTicket.id, 'PREPARING'), setTicket(barTicket.id, 'PREPARING')]);
    expect(race.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(race.filter((r) => r.statusCode === 409)).toHaveLength(2);
  });

  it('leaves a settled bill untouched when a served ticket is cancelled late', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, food.id, 1);
    const ticket = (await send(tabId)).json().tickets[0];
    await setTicket(ticket.id, 'PREPARING');
    await setTicket(ticket.id, 'READY');
    await settle(tabId, { payments: [{ method: 'CASH' }] });
    expect((await setTicket(ticket.id, 'CANCELLED')).statusCode).toBe(200);
    const tab = (await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${tabId}`, headers: as(bar) })).json();
    expect(tab).toMatchObject({ status: 'SETTLED', totalPaise: 30000 });
    expect(tab.items[0].status).toBe('SENT');
  });

  // --------------------------------------------------------------- tab list

  it('lists tabs by status with pagination and without line items', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 3);
    const res = await app.inject({ method: 'GET', url: '/api/v1/bar/tabs?limit=2', headers: as(bar) });
    expect(res.statusCode).toBe(200);
    const page = TabSummaryPageSchema.parse(res.json());
    expect(page.data.length).toBeLessThanOrEqual(2);
    expect(page.meta.limit).toBe(2);
    expect(page.data.every((t) => t.status === 'OPEN')).toBe(true);

    const wide = TabSummaryPageSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/bar/tabs?limit=100', headers: as(bar) })).json()
    );
    expect(wide.data.find((t) => t.id === tabId)?.itemCount).toBe(1);

    await settle(tabId, { payments: [{ method: 'CASH' }] });
    const today = clubDateOf(new Date(), TZ);
    const settled = TabSummaryPageSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/bar/tabs?status=SETTLED&date=${today}&limit=100`, headers: as(bar) })).json()
    );
    expect(settled.data.some((t) => t.id === tabId)).toBe(true);
    const otherDay = TabSummaryPageSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/bar/tabs?status=SETTLED&date=2001-01-01`, headers: as(bar) })).json()
    );
    expect(otherDay.data).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/bar/tabs?status=BOGUS', headers: as(bar) })).statusCode).toBe(400);
  });

  // --------------------------------------------------------------- earnings

  it('earnings equal the sum of bar payments, split by method, with the best sellers', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const before = BarEarningsSchema.parse((await earnings()).json());

    const a = await guestTab();
    await addItem(a, drink.id, 2); // 80000
    await settle(a, { payments: [{ method: 'CASH' }] });
    const b = (await openTab({ memberId })).json().id as string;
    await addItem(b, food.id, 2); // 60000 -> 57000
    await settle(b, { payments: [{ method: 'UPI', amountPaise: 20000 }, { method: 'CARD', amountPaise: 37000 }] });

    const after = BarEarningsSchema.parse((await earnings()).json());
    expect(after.totalPaise - before.totalPaise).toBe(80000 + 57000);
    expect(after.tabsSettled - before.tabsSettled).toBe(2);
    const method = (e: typeof after, m: string) => e.byMethod.find((x) => x.method === m)?.amountPaise ?? 0;
    expect(method(after, 'CASH') - method(before, 'CASH')).toBe(80000);
    expect(method(after, 'UPI') - method(before, 'UPI')).toBe(20000);
    expect(method(after, 'CARD') - method(before, 'CARD')).toBe(37000);
    expect(after.byMethod.reduce((s, m) => s + m.amountPaise, 0)).toBe(after.totalPaise);
    expect(after.averageTabPaise).toBe(Math.round(after.totalPaise / after.tabsSettled));
    expect(after.topItems.some((i) => i.name === `${PREFIX} Mojito`)).toBe(true);
    expect(after.date).toBe(clubDateOf(new Date(), TZ));
  });

  it('puts a payment made at 23:30 club time on the club day, not the UTC day', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    await addItem(tabId, drink.id, 1);
    await settle(tabId, { payments: [{ method: 'CASH' }] });
    // 23:30 IST on 2031-03-10 is 18:00 UTC the same day; 00:30 IST on 2031-03-11 is 19:00 UTC on 03-10.
    await db.update(payments).set({ paidAt: new Date('2031-03-10T19:00:00Z') }).where(eq(payments.sourceId, tabId));
    await db.update(tabs).set({ settledAt: new Date('2031-03-10T19:00:00Z') }).where(eq(tabs.id, tabId));

    const clubDay = BarEarningsSchema.parse((await earnings('2031-03-11')).json());
    const utcDay = BarEarningsSchema.parse((await earnings('2031-03-10')).json());
    expect(clubDay.totalPaise).toBe(40000);
    expect(utcDay.totalPaise).toBe(0);
    expect(utcDay.averageTabPaise).toBe(0);
  });

  // ------------------------------------------------- authorization (rule T3)

  it('rejects unauthenticated callers with 401 on every bar route', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const id = randomUUID();
    // Bodies are valid on purpose: schema validation runs before the auth hook.
    const calls: Array<[string, string, object?]> = [
      ['GET', '/bar/tables'], ['GET', '/bar/menu'],
      ['POST', '/bar/menu', { name: 'x', category: 'DRINK', station: 'BAR', pricePaise: 100 }],
      ['PUT', `/bar/menu/${id}`, { name: 'x' }],
      ['POST', '/bar/tabs', { guestName: 'x' }], ['GET', '/bar/tabs'], ['GET', `/bar/tabs/${id}`],
      ['POST', `/bar/tabs/${id}/items`, { menuItemId: id, qty: 1 }],
      ['DELETE', `/bar/tabs/${id}/items/${id}`], ['POST', `/bar/tabs/${id}/send`],
      ['POST', `/bar/tabs/${id}/settle`, { payments: [{ method: 'CASH' }] }],
      ['POST', `/bar/tabs/${id}/void`, { reason: 'x' }], ['GET', '/bar/tickets'],
      ['PATCH', `/bar/tickets/${id}/status`, { status: 'PREPARING' }], ['GET', '/bar/earnings'],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({ method: method as 'GET', url: `/api/v1${url}`, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('keeps members and the front desk out of the bar entirely', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const tabId = await guestTab();
    const id = randomUUID();
    for (const actor of [memberUser, desk]) {
      const calls: Array<[string, string, object?]> = [
        ['GET', '/bar/tables'], ['GET', '/bar/menu'], ['POST', '/bar/tabs', { guestName: 'x' }], ['GET', '/bar/tabs'],
        ['GET', `/bar/tabs/${tabId}`], ['POST', `/bar/tabs/${tabId}/items`, { menuItemId: drink.id, qty: 1 }],
        ['POST', `/bar/tabs/${tabId}/send`], ['POST', `/bar/tabs/${tabId}/settle`, { payments: [{ method: 'CASH' }] }],
        ['POST', `/bar/tabs/${tabId}/void`, { reason: 'x' }], ['GET', '/bar/tickets'],
        ['PATCH', `/bar/tickets/${id}/status`, { status: 'PREPARING' }], ['GET', '/bar/earnings'],
        ['POST', '/bar/menu', { name: 'x', category: 'DRINK', station: 'BAR', pricePaise: 100 }],
      ];
      for (const [method, url, payload] of calls) {
        const res = await app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: as(actor), payload });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
    }
    expect((await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${tabId}`, headers: as(bar) })).json().status).toBe('OPEN');
  });

  it('keeps owner-only actions from bar staff: menu edits, voids and other days of earnings', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    expect((await createMenu(bar, { name: 'Free beer', category: 'DRINK', station: 'BAR', pricePaise: 1 })).statusCode).toBe(403);
    const put = await app.inject({ method: 'PUT', url: `/api/v1/bar/menu/${drink.id}`, headers: as(bar), payload: { pricePaise: 1 } });
    expect(put.statusCode).toBe(403);
    const [still] = await db.select().from(menuItems).where(eq(menuItems.id, drink.id));
    expect(still.pricePaise).toBe(40000);

    const own = await earnings(undefined, bar);
    expect(own.statusCode).toBe(200);
    expect((await earnings(clubDateOf(new Date(), TZ), bar)).statusCode).toBe(200);
    const other = await earnings('2001-01-01', bar);
    expect(other.statusCode).toBe(403);
    expect(other.json().code).toBe('FORBIDDEN');
    expect((await earnings('2001-01-01', owner)).statusCode).toBe(200);
    expect((await earnings('not-a-date', owner)).statusCode).toBe(400);
  });

  it('keeps bar staff away from finance: no reports or payments permission, and no way in over HTTP', async (ctx) => {
    const actionsOf = (policy: { statements: Array<{ actions: readonly string[] }> }) =>
      policy.statements.flatMap((s) => [...s.actions]);
    const barActions = actionsOf(IamConfig.policies.BarStaffPolicy);
    expect(barActions.filter((a) => a.startsWith('reports:') || a.startsWith('payments:'))).toEqual([]);
    expect(actionsOf(IamConfig.policies.OwnerPolicy)).toContain('reports:read');

    if (!hasDatabase) return ctx.skip();
    for (const url of ['/reports/dashboard', '/reports/export.csv', '/payments']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: as(bar) });
      // 403 once those routes exist (guarded by reports:read / payments:read); 404 until then.
      // Either way the bar role never receives data.
      expect([403, 404], url).toContain(res.statusCode);
    }
  });

  it('never exposes stack traces or internals in bar error responses', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const res = await app.inject({ method: 'GET', url: `/api/v1/bar/tabs/${randomUUID()}`, headers: as(bar) });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toMatch(/at .*\.(ts|js):\d+/);
    expect(res.json().requestId).toBeTruthy();
  });
});
