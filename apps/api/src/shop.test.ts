import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_TENANT_ID, getDb,
  members,
  memberships,
  notifications,
  orders,
  payments,
  plans,
  products,
  roles,
  stockMovements,
  userRoles,
  users } from '@packages/db';
import {
  OrderSchema,
  ProductSchema,
  PublicProductSchema,
  QuoteOrderResponseSchema,
} from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { normaliseItems, priceOrder, unitPriceFor, type ProductRow } from './services/shop.service.js';

const API = '/api/v1';

function fakeProduct(over: Partial<ProductRow>): ProductRow {
  return {
    id: randomUUID(),
    sku: 'X',
    name: 'X',
    category: 'BALL',
    description: null,
    imageUrl: null,
    pricePaise: 1000,
    discountable: true,
    stockQty: 10,
    reorderLevel: 5,
    lowStockAlertedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('Shop pricing (unit)', () => {
  it('applies the plan discount only to discountable products and snapshots it per line', () => {
    const a = fakeProduct({ pricePaise: 450000 });
    const b = fakeProduct({ pricePaise: 20000, discountable: false });
    const rows = new Map([
      [a.id, a],
      [b.id, b],
    ]);

    const p = priceOrder(rows, [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 2 }], 15, 0);

    expect(p.lines[0]).toMatchObject({ discountPct: 15, lineTotalPaise: 382500 });
    expect(p.lines[1]).toMatchObject({ discountPct: 0, lineTotalPaise: 40000 });
    expect(p.subtotalPaise).toBe(490000);
    expect(p.discountPaise).toBe(67500);
    expect(p.totalPaise).toBe(422500);
  });

  it('adds the delivery fee on top and keeps total = subtotal - discount + fee', () => {
    const a = fakeProduct({ pricePaise: 999 });
    const p = priceOrder(new Map([[a.id, a]]), [{ productId: a.id, qty: 3 }], 10, 5000);
    expect(p.totalPaise).toBe(p.subtotalPaise - p.discountPaise + 5000);
  });

  it('unitPriceFor rounds to whole paise and ignores non discountable products', () => {
    expect(unitPriceFor({ pricePaise: 999, discountable: true }, 15)).toBe(849);
    expect(unitPriceFor({ pricePaise: 999, discountable: false }, 15)).toBe(999);
  });

  it('normaliseItems merges duplicates and sorts by id (the lock order)', () => {
    const out = normaliseItems([
      { productId: 'b', qty: 1 },
      { productId: 'a', qty: 2 },
      { productId: 'b', qty: 3 },
    ]);
    expect(out).toEqual([
      { productId: 'a', qty: 2 },
      { productId: 'b', qty: 4 },
    ]);
  });
});

describe('Shop and inventory (M-11)', () => {
  let app: FastifyInstance;
  let hasDatabase = false;
  const db = getDb();

  const userIds: string[] = [];
  const memberIds: string[] = [];
  const planIds: string[] = [];
  const productIds: string[] = [];

  interface Actor {
    id: string;
    cookie: string;
    memberId?: string;
  }
  let owner: Actor;
  let desk: Actor;
  let memberA: Actor; // GOLD-like, 15% shop discount
  let memberB: Actor; // no active plan
  let loginOnly: Actor; // a MEMBER login with no member profile
  let planId: string;

  // Every request gets its own client IP so the global 100/min rate limit does not trip a
  // test suite that makes hundreds of calls. The rate-limit test pins one IP explicitly.
  let ipCounter = 0;
  const nextIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

  async function call(
    actor: Actor | null,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: unknown
  ) {
    return app.inject({
      method,
      url: `${API}${url}`,
      remoteAddress: nextIp(),
      headers: actor ? { cookie: actor.cookie } : undefined,
      payload: payload as Record<string, unknown> | undefined,
    });
  }

  async function makeActor(roleName: 'OWNER' | 'FRONT_DESK' | 'MEMBER', withProfile = false): Promise<Actor> {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/auth/signup`,
      remoteAddress: nextIp(),
      payload: { email: `m11-${randomUUID()}@example.com`, password: 'Password123!', name: 'M11 Tester' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().user.id as string;
    userIds.push(id);
    const [role] = await db.select().from(roles).where(and(eq(roles.tenantId, DEFAULT_TENANT_ID), eq(roles.name, roleName))).limit(1);
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.insert(userRoles).values({ userId: id, roleId: role.id });
    const actor: Actor = {
      id,
      cookie: `app_session=${res.cookies.find((c) => c.name === 'app_session')!.value}`,
    };
    if (withProfile) {
      const [m] = await db
        .insert(members)
        .values({
          userId: id,
          memberCode: `T${randomUUID().slice(0, 8)}`,
          fullName: 'M11 Member',
          phone: '+910000000000',
        })
        .returning({ id: members.id });
      memberIds.push(m.id);
      actor.memberId = m.id;
    }
    return actor;
  }

  async function makeProduct(over: Partial<typeof products.$inferInsert> = {}) {
    const [p] = await db
      .insert(products)
      .values({
        sku: `M11-${randomUUID()}`,
        name: 'M11 Product',
        category: 'ACCESSORY',
        pricePaise: 10000,
        stockQty: 10,
        reorderLevel: 2,
        ...over,
      })
      .returning();
    productIds.push(p.id);
    return p;
  }

  async function stockOf(id: string): Promise<number> {
    const [p] = await db.select({ q: products.stockQty }).from(products).where(eq(products.id, id));
    return p.q;
  }

  function pos(actor: Actor, items: { productId: string; qty: number }[], extra: Record<string, unknown> = {}) {
    return call(actor, 'POST', '/orders/pos', { items, paymentMethod: 'CASH', ...extra });
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
    if (!hasDatabase) return;
    const roleRows = await db
      .select({ name: roles.name })
      .from(roles)
      .where(and(eq(roles.tenantId, DEFAULT_TENANT_ID), inArray(roles.name, ['OWNER', 'FRONT_DESK', 'MEMBER'])));
    if (roleRows.length < 3) {
      // Roles come from `pnpm db:seed`; without them these tests cannot run meaningfully.
      hasDatabase = false;
      return;
    }
    const [plan] = await db
      .insert(plans)
      .values({
        code: `M11${randomUUID().slice(0, 8)}`,
        name: 'M11 Plan',
        monthlyFeePaise: 100000,
        shopDiscountPct: 15,
      })
      .returning({ id: plans.id });
    planId = plan.id;
    planIds.push(plan.id);

    owner = await makeActor('OWNER');
    desk = await makeActor('FRONT_DESK');
    memberA = await makeActor('MEMBER', true);
    memberB = await makeActor('MEMBER', true);
    loginOnly = await makeActor('MEMBER');
    await db.insert(memberships).values({
      memberId: memberA.memberId!,
      planId,
      status: 'ACTIVE',
      startsOn: '2000-01-01',
      endsOn: '2999-12-31',
    });
  }, 60_000);

  afterAll(async () => {
    if (hasDatabase) {
      const orderRows = productIds.length
        ? await db
            .selectDistinct({ id: stockMovements.orderId })
            .from(stockMovements)
            .where(inArray(stockMovements.productId, productIds))
        : [];
      const memberOrders = memberIds.length
        ? await db.select({ id: orders.id }).from(orders).where(inArray(orders.memberId, memberIds))
        : [];
      const orderIds = [...orderRows.map((r) => r.id), ...memberOrders.map((r) => r.id)].filter(
        (x): x is string => Boolean(x)
      );
      if (orderIds.length) {
        await db.delete(payments).where(inArray(payments.sourceId, orderIds));
        await db
          .delete(notifications)
          .where(inArray(sql`${notifications.data}->>'orderId'`, orderIds));
      }
      if (productIds.length) {
        await db
          .delete(notifications)
          .where(inArray(sql`${notifications.data}->>'productId'`, productIds));
        await db.delete(stockMovements).where(inArray(stockMovements.productId, productIds));
      }
      if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
      if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
      if (memberIds.length) await db.delete(members).where(inArray(members.id, memberIds));
      if (planIds.length) await db.delete(plans).where(inArray(plans.id, planIds));
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  describe('authentication (401) and validation', () => {
    const id = randomUUID();
    it.each([
      ['GET', '/products'],
      ['GET', `/products/${id}`],
      ['POST', '/products'],
      ['PUT', `/products/${id}`],
      ['POST', `/products/${id}/restock`],
      ['POST', `/products/${id}/adjust`],
      ['GET', `/products/${id}/movements`],
      ['GET', '/inventory/low-stock'],
      ['POST', '/orders/quote'],
      ['POST', '/orders/pos'],
      ['POST', '/orders/online'],
      ['GET', '/orders'],
      ['GET', '/me/orders'],
      ['GET', `/orders/${id}`],
      ['PATCH', `/orders/${id}/status`],
      ['POST', `/orders/${id}/pay`],
    ] as const)('%s %s returns 401 without a session', async (method, url) => {
      // Fastify validates the body before preHandlers run, so send a valid body to reach the 401.
      const line = [{ productId: id, qty: 1 }];
      const bodies: Record<string, unknown> = {
        'POST /products': { sku: 's', name: 'n', category: 'BALL', pricePaise: 1, stockQty: 0 },
        [`PUT /products/${id}`]: { name: 'n' },
        [`POST /products/${id}/restock`]: { qty: 1 },
        [`POST /products/${id}/adjust`]: { qtyDelta: 1, note: 'n' },
        'POST /orders/quote': { items: line },
        'POST /orders/pos': { items: line, paymentMethod: 'CASH' },
        'POST /orders/online': { items: line, fulfilment: 'PICKUP' },
        [`PATCH /orders/${id}/status`]: { status: 'READY' },
        [`POST /orders/${id}/pay`]: { method: 'CASH' },
      };
      const res = await call(null, method, url, bodies[`${method} ${url}`]);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
      expect(res.json().requestId).toBeDefined();
    });

    it('rejects malformed input with 400 and field details', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const cases: [Actor, 'POST' | 'GET' | 'PATCH', string, unknown][] = [
        [desk, 'POST', '/orders/pos', { items: [], paymentMethod: 'CASH' }],
        [desk, 'POST', '/orders/pos', { items: [{ productId: 'nope', qty: 1 }], paymentMethod: 'CASH' }],
        [desk, 'POST', '/orders/pos', { items: [{ productId: randomUUID(), qty: 0 }], paymentMethod: 'CASH' }],
        [desk, 'POST', '/orders/pos', { items: [{ productId: randomUUID(), qty: 1 }], paymentMethod: 'BITCOIN' }],
        [desk, 'POST', '/orders/quote', { items: [] }],
        [memberA, 'POST', '/orders/online', { items: [{ productId: randomUUID(), qty: 1 }], fulfilment: 'DELIVERY' }],
        [owner, 'POST', '/products', { sku: '', name: 'x', category: 'NOPE', pricePaise: -1, stockQty: 0 }],
        [desk, 'GET', '/orders?status=EXPLODED', undefined],
        [desk, 'PATCH', `/orders/${randomUUID()}/status`, { status: 'CANCELLED' }],
        [desk, 'GET', '/orders/not-a-uuid', undefined],
      ];
      for (const [actor, method, url, payload] of cases) {
        const res = await call(actor, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(400);
        expect(res.json().requestId).toBeDefined();
      }
    });

    it('rejects an invalid from/to filter with 400', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const res = await call(desk, 'GET', '/orders?from=banana');
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('authorization (403) and adversarial access', () => {
    it('a member is forbidden from every staff route', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const probes: ['GET' | 'POST' | 'PUT' | 'PATCH', string, unknown][] = [
        ['POST', '/orders/pos', { items: [{ productId: p.id, qty: 1 }], paymentMethod: 'CASH' }],
        ['GET', '/orders', undefined],
        ['GET', '/inventory/low-stock', undefined],
        ['GET', `/products/${p.id}/movements`, undefined],
        ['POST', `/products/${p.id}/restock`, { qty: 5 }],
        ['POST', `/products/${p.id}/adjust`, { qtyDelta: 5, note: 'x' }],
        ['POST', '/products', { sku: 'S', name: 'n', category: 'BALL', pricePaise: 1, stockQty: 1 }],
        ['PUT', `/products/${p.id}`, { name: 'hacked' }],
        ['PATCH', `/orders/${randomUUID()}/status`, { status: 'READY' }],
      ];
      for (const [method, url, payload] of probes) {
        const res = await call(memberA, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      }
      expect(await stockOf(p.id)).toBe(10);
    });

    it('front desk can restock but not create, edit or adjust products; owner can', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      expect((await call(desk, 'POST', '/products', { sku: 'S', name: 'n', category: 'BALL', pricePaise: 1, stockQty: 1 })).statusCode).toBe(403);
      expect((await call(desk, 'PUT', `/products/${p.id}`, { name: 'x' })).statusCode).toBe(403);
      expect((await call(desk, 'POST', `/products/${p.id}/adjust`, { qtyDelta: 1, note: 'n' })).statusCode).toBe(403);
      expect((await call(desk, 'POST', `/products/${p.id}/restock`, { qty: 1 })).statusCode).toBe(200);
      expect((await call(owner, 'POST', `/products/${p.id}/adjust`, { qtyDelta: 1, note: 'n' })).statusCode).toBe(200);
    });

    it('staff cannot use the member-only online order route', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const res = await call(desk, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      expect(res.statusCode).toBe(403);
      expect(await stockOf(p.id)).toBe(10);
    });

    it('a member cannot read, pay or advance another member\'s order', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const placed = await call(memberA, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      expect(placed.statusCode).toBe(201);
      const orderId = placed.json().id as string;

      expect((await call(memberB, 'GET', `/orders/${orderId}`)).statusCode).toBe(403);
      expect((await call(memberB, 'POST', `/orders/${orderId}/pay`, { method: 'UPI' })).statusCode).toBe(403);
      expect((await call(memberB, 'PATCH', `/orders/${orderId}/status`, { status: 'READY' })).statusCode).toBe(403);
      expect((await call(loginOnly, 'GET', `/orders/${orderId}`)).statusCode).toBe(403);

      const mine = await call(memberA, 'GET', `/orders/${orderId}`);
      expect(mine.statusCode).toBe(200);

      const theirs = await call(memberB, 'GET', '/me/orders');
      expect(theirs.statusCode).toBe(200);
      expect(theirs.json().data.map((o: { id: string }) => o.id)).not.toContain(orderId);
      const ownList = await call(memberA, 'GET', '/me/orders');
      expect(ownList.json().data.map((o: { id: string }) => o.id)).toContain(orderId);

      const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(row.status).toBe('PLACED');
      expect(row.paymentStatus).toBe('UNPAID');
    });

    it('a member cannot quote as another member to farm their discount', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const res = await call(memberB, 'POST', '/orders/quote', {
        memberId: memberA.memberId,
        items: [{ productId: p.id, qty: 1 }],
      });
      expect(res.statusCode).toBe(403);
    });

    it('checkout: payNow by card records a card payment for the server-computed total, and card pay works on an unpaid order (#68)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 12345 });
      const res = await call(memberA, 'POST', '/orders/online', { items: [{ productId: p.id, qty: 2 }], fulfilment: 'PICKUP', payNow: { method: 'CARD' } });
      expect(res.statusCode, res.body).toBe(201);
      const o = res.json();
      expect(o.paymentStatus).toBe('PAID');
      const [pay] = await db.select().from(payments).where(eq(payments.sourceId, o.id));
      expect(pay).toMatchObject({ source: 'SHOP', method: 'CARD', amountPaise: o.totalPaise });
      expect(o.totalPaise).toBe(o.subtotalPaise - o.discountPaise + o.deliveryFeePaise);
      // Cash at pickup: placed unpaid; the member cannot mark it paid by cash, and another member cannot pay it at all.
      const unpaid = (await call(memberA, 'POST', '/orders/online', { items: [{ productId: p.id, qty: 1 }], fulfilment: 'PICKUP' })).json();
      expect(unpaid.paymentStatus).toBe('UNPAID');
      expect((await call(memberB, 'POST', `/orders/${unpaid.id}/pay`, { method: 'CARD' })).statusCode).toBe(403);
      expect((await call(memberA, 'POST', `/orders/${unpaid.id}/pay`, { method: 'CARD' })).statusCode).toBe(200);
      expect((await call(memberA, 'POST', '/orders/online', { items: [{ productId: p.id, qty: 1 }], fulfilment: 'PICKUP', payNow: { method: 'CASH' } })).statusCode).toBe(400);
    });

    it('a member can pay their own order by UPI or card, never by cash (#68)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 20000 });
      const placed = await call(memberA, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      const orderId = placed.json().id as string;

      expect((await call(memberA, 'POST', `/orders/${orderId}/pay`, { method: 'CASH' })).statusCode).toBe(403);
      const paid = await call(memberA, 'POST', `/orders/${orderId}/pay`, { method: 'UPI', reference: 'upi-1' });
      expect(paid.statusCode).toBe(200);
      expect(paid.json().order.paymentStatus).toBe('PAID');
      expect(paid.json().payment.amountPaise).toBe(placed.json().totalPaise);

      const again = await call(memberA, 'POST', `/orders/${orderId}/pay`, { method: 'UPI' });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('ALREADY_PAID');
      const rows = await db.select().from(payments).where(eq(payments.sourceId, orderId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'SHOP', kind: 'PAYMENT', method: 'UPI', memberId: memberA.memberId });
    });

    it('a MEMBER login without a member profile cannot place online orders', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const res = await call(loginOnly, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('MEMBER_PROFILE_REQUIRED');
      expect(await stockOf(p.id)).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  describe('counter sale (POS)', () => {
    it('sells, decrements stock, writes movement with balance_after and a SHOP payment row', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 45000, stockQty: 5 });

      const res = await pos(desk, [{ productId: p.id, qty: 2 }], { customerName: 'Walk-in' });

      expect(res.statusCode).toBe(201);
      const order = OrderSchema.parse(res.json());
      expect(order).toMatchObject({
        channel: 'POS',
        fulfilment: 'COUNTER',
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        subtotalPaise: 90000,
        discountPaise: 0,
        deliveryFeePaise: 0,
        totalPaise: 90000,
        member: null,
        customerName: 'Walk-in',
      });
      expect(order.orderNumber).toMatch(/^ORD-\d{6}$/);
      expect(await stockOf(p.id)).toBe(3);
      const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.productId, p.id));
      expect(mv).toMatchObject({ qtyDelta: -2, balanceAfter: 3, reason: 'SALE_COUNTER', orderId: order.id });
      const [pay] = await db.select().from(payments).where(eq(payments.sourceId, order.id));
      expect(pay).toMatchObject({ source: 'SHOP', kind: 'PAYMENT', amountPaise: 90000, method: 'CASH', receivedBy: desk.id });
    });

    it('order numbers increase and never repeat', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 5 });
      const a = (await pos(desk, [{ productId: p.id, qty: 1 }])).json().orderNumber as string;
      const b = (await pos(desk, [{ productId: p.id, qty: 1 }])).json().orderNumber as string;
      expect(Number(b.slice(4))).toBeGreaterThan(Number(a.slice(4)));
    });

    it('merges duplicate lines of the same product', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 5, pricePaise: 100 });
      const res = await pos(desk, [
        { productId: p.id, qty: 1 },
        { productId: p.id, qty: 2 },
      ]);
      expect(res.statusCode).toBe(201);
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].qty).toBe(3);
      expect(await stockOf(p.id)).toBe(2);
    });

    it('applies the member discount from the member\'s active plan, equal to quote()', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const shoe = await makeProduct({ pricePaise: 450000 });
      const cap = await makeProduct({ pricePaise: 20000, discountable: false });
      const items = [
        { productId: shoe.id, qty: 1 },
        { productId: cap.id, qty: 2 },
      ];

      const quote = await call(desk, 'POST', '/orders/quote', { memberId: memberA.memberId, items });
      const order = await pos(desk, items, { memberId: memberA.memberId });

      expect(quote.statusCode).toBe(200);
      const q = QuoteOrderResponseSchema.parse(quote.json());
      expect(q.discountPct).toBe(15);
      expect(order.statusCode).toBe(201);
      const o = order.json();
      expect(o.totalPaise).toBe(q.totalPaise);
      expect(o.discountPaise).toBe(q.discountPaise);
      expect(o.subtotalPaise).toBe(q.subtotalPaise);
      expect(q.discountPaise).toBe(67500);
      expect(o.member.id).toBe(memberA.memberId);
      const byProduct = new Map(o.items.map((i: { productId: string }) => [i.productId, i]));
      expect(byProduct.get(shoe.id)).toMatchObject({ discountPct: 15, lineTotalPaise: 382500 });
      expect(byProduct.get(cap.id)).toMatchObject({ discountPct: 0, lineTotalPaise: 40000 });
      const [pay] = await db.select().from(payments).where(eq(payments.sourceId, o.id));
      expect(pay.amountPaise).toBe(q.totalPaise);
      expect(pay.memberId).toBe(memberA.memberId);
    });

    it('a member quoting for themselves, and a guest quote, are priced server-side', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 10000 });
      const items = [{ productId: p.id, qty: 1 }];
      const own = await call(memberA, 'POST', '/orders/quote', { items });
      const guest = await call(memberB, 'POST', '/orders/quote', { items });
      const staffGuest = await call(desk, 'POST', '/orders/quote', { items });
      expect(own.json().totalPaise).toBe(8500);
      expect(guest.json().totalPaise).toBe(10000);
      expect(staffGuest.json().totalPaise).toBe(10000);
      expect(own.json().items[0].inStock).toBe(true);
    });

    it('an unknown member id gives 404 and sells nothing', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const res = await pos(desk, [{ productId: p.id, qty: 1 }], { memberId: randomUUID() });
      expect(res.statusCode).toBe(404);
      expect(await stockOf(p.id)).toBe(10);
    });

    it('an unknown or inactive product gives 404', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const inactive = await makeProduct({ isActive: false });
      expect((await pos(desk, [{ productId: randomUUID(), qty: 1 }])).statusCode).toBe(404);
      expect((await pos(desk, [{ productId: inactive.id, qty: 1 }])).statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('stock integrity (BR-13)', () => {
    it('OUT_OF_STOCK lists every short product and rolls the whole order back', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const plenty = await makeProduct({ stockQty: 10 });
      const scarce = await makeProduct({ stockQty: 1, name: 'Scarce Shoes' });

      const res = await pos(desk, [
        { productId: plenty.id, qty: 3 },
        { productId: scarce.id, qty: 2 },
      ]);

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe('OUT_OF_STOCK');
      expect(body.message).toContain('Scarce Shoes');
      expect(body.requestId).toBeDefined();
      expect(body.details).toHaveLength(1);
      expect(body.details[0].message).toBe('requested 2, available 1');
      expect(await stockOf(plenty.id)).toBe(10);
      expect(await stockOf(scarce.id)).toBe(1);
      const moves = await db.select().from(stockMovements).where(inArray(stockMovements.productId, [plenty.id, scarce.id]));
      expect(moves).toHaveLength(0);
    });

    it('two concurrent buyers for the last unit: one 201 and one OUT_OF_STOCK, and the shelf flips on /public/products', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 1, name: 'Last Shoe', sku: `LAST-${randomUUID()}` });
      const before = await call(null, 'GET', `/public/products?q=${p.sku}`);
      expect(before.json().data[0].inStock).toBe(true);

      const [a, b] = await Promise.all([
        pos(desk, [{ productId: p.id, qty: 1 }]),
        call(memberA, 'POST', '/orders/online', { items: [{ productId: p.id, qty: 1 }], fulfilment: 'PICKUP' }),
      ]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
      const loser = a.statusCode === 409 ? a : b;
      expect(loser.json().code).toBe('OUT_OF_STOCK');
      expect(await stockOf(p.id)).toBe(0);
      const sold = await db.select().from(stockMovements).where(eq(stockMovements.productId, p.id));
      expect(sold).toHaveLength(1);
      const after = await call(null, 'GET', `/public/products?q=${p.sku}`);
      expect(after.json().data[0].inStock).toBe(false);
    });

    it('stock never goes negative after 30 random concurrent orders (multi-product, shuffled lines)', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const shelf = await Promise.all([
        makeProduct({ stockQty: 12, reorderLevel: 0 }),
        makeProduct({ stockQty: 9, reorderLevel: 0 }),
        makeProduct({ stockQty: 15, reorderLevel: 0 }),
      ]);
      const initial = new Map(shelf.map((p) => [p.id, p.stockQty]));
      const rand = (n: number) => Math.floor(Math.random() * n);
      const requests = Array.from({ length: 30 }, (_, n) => {
        const chosen = shelf.filter(() => Math.random() < 0.6);
        if (chosen.length === 0) chosen.push(shelf[rand(3)]);
        // The first six orders always want 2 of the 9-unit product (12 > 9), so at least one
        // OUT_OF_STOCK is guaranteed rather than merely overwhelmingly likely.
        if (n < 6 && !chosen.includes(shelf[1])) chosen.push(shelf[1]);
        chosen.sort(() => Math.random() - 0.5); // reversed/shuffled lock order on purpose
        const items = chosen.map((p) => ({ productId: p.id, qty: n < 6 && p === shelf[1] ? 2 : 1 + rand(3) }));
        const useOnline = Math.random() < 0.3;
        return {
          items,
          res: useOnline
            ? call(memberA, 'POST', '/orders/online', { items, fulfilment: 'PICKUP' })
            : pos(desk, items),
        };
      });

      const settled = await Promise.all(requests.map(async (r) => ({ items: r.items, res: await r.res })));

      const sold = new Map<string, number>();
      for (const { items, res } of settled) {
        expect([201, 409]).toContain(res.statusCode);
        if (res.statusCode === 201) for (const i of items) sold.set(i.productId, (sold.get(i.productId) ?? 0) + i.qty);
        else expect(res.json().code).toBe('OUT_OF_STOCK');
      }
      for (const p of shelf) {
        const left = await stockOf(p.id);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBe(initial.get(p.id)! - (sold.get(p.id) ?? 0));
        const moves = await db.select().from(stockMovements).where(eq(stockMovements.productId, p.id));
        expect(moves.reduce((s, m) => s + m.qtyDelta, 0)).toBe(-(sold.get(p.id) ?? 0));
        expect(Math.min(...moves.map((m) => m.balanceAfter), left)).toBeGreaterThanOrEqual(0);
      }
      expect(settled.some((s) => s.res.statusCode === 409)).toBe(true);
    }, 60_000);

    it('the CHECK constraint is the safety net: a direct negative write is rejected by Postgres', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 1 });
      await expect(
        db.update(products).set({ stockQty: -1 }).where(eq(products.id, p.id))
      ).rejects.toThrow();
    });

    it('adjusting below zero is refused with 409 and writes nothing', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 2 });
      const res = await call(owner, 'POST', `/products/${p.id}/adjust`, { qtyDelta: -3, note: 'damaged' });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('STOCK_BELOW_ZERO');
      expect(await stockOf(p.id)).toBe(2);
    });

    it('restock and adjust write movements with balance_after and appear in the ledger', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 4 });
      const r = await call(desk, 'POST', `/products/${p.id}/restock`, { qty: 6, note: 'delivery' });
      const a = await call(owner, 'POST', `/products/${p.id}/adjust`, { qtyDelta: -1, note: 'shrinkage' });
      expect(r.statusCode).toBe(200);
      expect(r.json().movement).toMatchObject({ qtyDelta: 6, balanceAfter: 10, reason: 'RESTOCK' });
      ProductSchema.parse(r.json().product);
      expect(a.json().movement).toMatchObject({ qtyDelta: -1, balanceAfter: 9, reason: 'ADJUSTMENT' });

      const ledger = await call(desk, 'GET', `/products/${p.id}/movements`);
      expect(ledger.statusCode).toBe(200);
      expect(ledger.json().data.map((m: { balanceAfter: number }) => m.balanceAfter)).toEqual([9, 10]);
      expect((await call(desk, 'POST', `/products/${p.id}/restock`, { qty: 0 })).statusCode).toBe(400);
      expect((await call(desk, 'POST', `/products/${randomUUID()}/restock`, { qty: 1 })).statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('low-stock notifications (once per crossing)', () => {
    async function lowStockRows(productId: string, userId: string) {
      return db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, 'LOW_STOCK'),
            sql`${notifications.data}->>'productId' = ${productId}`
          )
        );
    }

    it('fires once at the crossing, not on later sales, and again only after restock then drop', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 6, reorderLevel: 4 });

      await pos(desk, [{ productId: p.id, qty: 1 }]); // 5, still above
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(0);

      await pos(desk, [{ productId: p.id, qty: 1 }]); // 4, crosses
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(1);
      expect(await lowStockRows(p.id, owner.id)).toHaveLength(1);
      expect(await lowStockRows(p.id, memberA.id)).toHaveLength(0);

      await pos(desk, [{ productId: p.id, qty: 1 }]); // 3, already alerted
      await pos(desk, [{ productId: p.id, qty: 1 }]); // 2
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(1);
      const [flag] = await db.select({ at: products.lowStockAlertedAt }).from(products).where(eq(products.id, p.id));
      expect(flag.at).not.toBeNull();

      await call(desk, 'POST', `/products/${p.id}/restock`, { qty: 20 }); // 22, clears
      const [cleared] = await db.select({ at: products.lowStockAlertedAt }).from(products).where(eq(products.id, p.id));
      expect(cleared.at).toBeNull();
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(1);

      await pos(desk, [{ productId: p.id, qty: 18 }]); // 4, crosses again (same day)
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(2);
      expect(await lowStockRows(p.id, owner.id)).toHaveLength(2);
    });

    it('a restock that stays at or below the level keeps the alert flag', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 1, reorderLevel: 5 });
      await pos(desk, [{ productId: p.id, qty: 1 }]); // 0 -> alert
      await call(desk, 'POST', `/products/${p.id}/restock`, { qty: 2 }); // 2, still low
      await pos(desk, [{ productId: p.id, qty: 1 }]); // 1, no second alert
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(1);
    });

    it('concurrent sales across the threshold raise exactly one alert', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 10, reorderLevel: 8 });
      await Promise.all(Array.from({ length: 6 }, () => pos(desk, [{ productId: p.id, qty: 1 }])));
      expect(await lowStockRows(p.id, desk.id)).toHaveLength(1);
    });

    it('GET /inventory/low-stock lists products at or below the level, most urgent first', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const worse = await makeProduct({ stockQty: 0, reorderLevel: 5 });
      const mild = await makeProduct({ stockQty: 5, reorderLevel: 5 });
      const fine = await makeProduct({ stockQty: 50, reorderLevel: 5 });

      const res = await call(desk, 'GET', '/inventory/low-stock');

      expect(res.statusCode).toBe(200);
      const list = res.json() as { product: { id: string }; shortBy: number }[];
      const ids = list.map((i) => i.product.id);
      expect(ids).toContain(worse.id);
      expect(ids).toContain(mild.id);
      expect(ids).not.toContain(fine.id);
      expect(ids.indexOf(worse.id)).toBeLessThan(ids.indexOf(mild.id));
      expect(list.find((i) => i.product.id === worse.id)!.shortBy).toBe(5);
      const shortBys = list.map((i) => i.shortBy);
      expect(shortBys).toEqual([...shortBys].sort((x, y) => y - x));
    });
  });

  // ---------------------------------------------------------------------------
  describe('online orders and fulfilment', () => {
    it('reserves stock at placement with a SALE_ONLINE movement and notifies the desk', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 5, pricePaise: 10000 });

      const res = await call(memberA, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 2 }],
        fulfilment: 'PICKUP',
      });

      expect(res.statusCode).toBe(201);
      const o = OrderSchema.parse(res.json());
      expect(o).toMatchObject({
        channel: 'ONLINE',
        fulfilment: 'PICKUP',
        status: 'PLACED',
        paymentStatus: 'UNPAID',
        deliveryFeePaise: 0,
        subtotalPaise: 20000,
        discountPaise: 3000,
        totalPaise: 17000,
      });
      expect(o.member?.id).toBe(memberA.memberId);
      expect(await stockOf(p.id)).toBe(3);
      const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.productId, p.id));
      expect(mv).toMatchObject({ reason: 'SALE_ONLINE', balanceAfter: 3, qtyDelta: -2 });
      const pays = await db.select().from(payments).where(eq(payments.sourceId, o.id));
      expect(pays).toHaveLength(0);
      const notes = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.type, 'ONLINE_ORDER'), sql`${notifications.data}->>'orderId' = ${o.id}`));
      // The alert fans out to every ACTIVE OWNER/FRONT_DESK in the database, and the database is
      // shared with other test files that create their own staff. So assert on this test's actors
      // and on the recipient set's shape, never on its exact size.
      const recipients = notes.map((n) => n.userId);
      expect(recipients.filter((id) => id === desk.id)).toHaveLength(1);
      expect(recipients.filter((id) => id === owner.id)).toHaveLength(1);
      expect(new Set(recipients).size).toBe(recipients.length);
      for (const member of [memberA, memberB, loginOnly]) expect(recipients).not.toContain(member.id);
      const roleRows = await db
        .select({ userId: userRoles.userId, name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, recipients));
      for (const id of recipients) {
        expect(roleRows.filter((r) => r.userId === id).some((r) => ['OWNER', 'FRONT_DESK'].includes(r.name))).toBe(true);
      }
    });

    it('delivery adds the fee and requires the address; payNow records a UPI payment', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 10000 });

      const res = await call(memberB, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'DELIVERY',
        deliveryAddress: '12 Court Road',
        payNow: { method: 'UPI' },
      });

      expect(res.statusCode).toBe(201);
      const o = res.json();
      expect(o.fulfilment).toBe('DELIVERY');
      expect(o.deliveryAddress).toBe('12 Court Road');
      expect(o.deliveryFeePaise).toBeGreaterThan(0);
      expect(o.totalPaise).toBe(o.subtotalPaise - o.discountPaise + o.deliveryFeePaise);
      expect(o.paymentStatus).toBe('PAID');
      const [pay] = await db.select().from(payments).where(eq(payments.sourceId, o.id));
      expect(pay).toMatchObject({ source: 'SHOP', method: 'UPI', amountPaise: o.totalPaise });

      const quote = await call(memberB, 'POST', '/orders/quote', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'DELIVERY',
      });
      expect(quote.json().deliveryFeePaise).toBe(o.deliveryFeePaise);
      expect(quote.json().totalPaise).toBe(o.totalPaise);
    });

    it('walks the pickup flow PLACED to READY to COLLECTED and refuses illegal jumps', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const placed = await call(memberA, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      const id = placed.json().id as string;

      const skip = await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'COLLECTED' });
      const wrongFlow = await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'OUT_FOR_DELIVERY' });
      const ready = await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'READY' });
      const readyAgain = await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'READY' });
      const collected = await call(owner, 'PATCH', `/orders/${id}/status`, { status: 'COLLECTED' });
      const after = await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'READY' });

      expect(skip.statusCode).toBe(409);
      expect(skip.json().code).toBe('ORDER_STATE_INVALID');
      expect(wrongFlow.statusCode).toBe(409);
      expect(ready.statusCode).toBe(200);
      expect(ready.json().status).toBe('READY');
      expect(readyAgain.statusCode).toBe(409);
      expect(collected.json().status).toBe('COLLECTED');
      expect(after.statusCode).toBe(409);
      expect((await call(desk, 'PATCH', `/orders/${randomUUID()}/status`, { status: 'READY' })).statusCode).toBe(404);
    });

    it('walks the delivery flow and refuses to move counter sales', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 10 });
      const placed = await call(memberA, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'DELIVERY',
        deliveryAddress: 'Somewhere',
      });
      const id = placed.json().id as string;
      expect((await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'READY' })).statusCode).toBe(409);
      expect((await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'OUT_FOR_DELIVERY' })).json().status).toBe('OUT_FOR_DELIVERY');
      expect((await call(desk, 'PATCH', `/orders/${id}/status`, { status: 'DELIVERED' })).json().status).toBe('DELIVERED');

      const counter = await pos(desk, [{ productId: p.id, qty: 1 }]);
      const moved = await call(desk, 'PATCH', `/orders/${counter.json().id}/status`, { status: 'READY' });
      expect(moved.statusCode).toBe(409);
      expect(moved.json().code).toBe('ORDER_STATE_INVALID');
    });

    it('staff can take payment for an unpaid order once; POS orders are already paid', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 5000 });
      const placed = await call(memberB, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      const id = placed.json().id as string;

      const [a, b] = await Promise.all([
        call(desk, 'POST', `/orders/${id}/pay`, { method: 'CASH' }),
        call(desk, 'POST', `/orders/${id}/pay`, { method: 'CARD' }),
      ]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const pays = await db.select().from(payments).where(eq(payments.sourceId, id));
      expect(pays).toHaveLength(1);
      expect(pays[0].receivedBy).toBe(desk.id);
      const ok = a.statusCode === 200 ? a : b;
      expect(ok.json().payment).toMatchObject({ amountPaise: 5000 });

      const counter = await pos(desk, [{ productId: p.id, qty: 1 }]);
      const dup = await call(desk, 'POST', `/orders/${counter.json().id}/pay`, { method: 'CASH' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('ALREADY_PAID');
      expect((await call(desk, 'POST', `/orders/${randomUUID()}/pay`, { method: 'CASH' })).statusCode).toBe(404);
    });

    it('GET /orders filters by status, channel and club date, and staff can read any order', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct();
      const placed = await call(memberA, 'POST', '/orders/online', {
        items: [{ productId: p.id, qty: 1 }],
        fulfilment: 'PICKUP',
      });
      const id = placed.json().id as string;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

      const filtered = await call(desk, 'GET', `/orders?status=PLACED&channel=ONLINE&fulfilment=PICKUP&from=${today}&to=${today}&limit=100`);
      const wrong = await call(desk, 'GET', '/orders?channel=POS&status=PLACED&limit=100');

      expect(filtered.statusCode).toBe(200);
      expect(filtered.json().data.map((o: { id: string }) => o.id)).toContain(id);
      expect(filtered.json().meta).toMatchObject({ page: 1, limit: 100 });
      expect(wrong.json().data.map((o: { id: string }) => o.id)).not.toContain(id);
      expect((await call(owner, 'GET', `/orders/${id}`)).statusCode).toBe(200);
      expect((await call(desk, 'GET', `/orders/${randomUUID()}`)).statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('catalogue visibility', () => {
    it('GET /public/products works without a session and exposes no stock numbers or staff fields', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ stockQty: 3, reorderLevel: 5, sku: `PUB-${randomUUID()}` });
      await makeProduct({ isActive: false, sku: `HID-${randomUUID()}` });

      const res = await call(null, 'GET', `/public/products?q=${p.sku}`);

      expect(res.statusCode).toBe(200);
      const item = res.json().data[0];
      expect(Object.keys(item).sort()).toEqual(
        ['category', 'id', 'imageUrl', 'inStock', 'name', 'pricePaise', 'sku'].sort()
      );
      PublicProductSchema.parse(item);
      expect(item.inStock).toBe(true);
      expect(JSON.stringify(res.json())).not.toMatch(/stockQty|reorderLevel|lowStock|isActive|discount/);
      const hidden = await call(null, 'GET', '/public/products?q=HID-&limit=100');
      expect(hidden.json().data.every((x: { sku: string }) => !x.sku.startsWith('HID-'))).toBe(true);
    });

    it('GET /public/products is rate limited to 30 per minute per IP', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const ip = '203.0.113.77';
      const codes: number[] = [];
      for (let i = 0; i < 31; i++) {
        const res = await app.inject({ method: 'GET', url: `${API}/public/products?limit=1`, remoteAddress: ip });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
      expect(codes[30]).toBe(429);
    });

    it('public products reject bad query values with 400', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      expect((await call(null, 'GET', '/public/products?category=GUNS')).json().data).toEqual([]); // unknown but well-formed: empty filter
      expect((await call(null, 'GET', '/public/products?category=guns')).statusCode).toBe(400); // malformed code
      expect((await call(null, 'GET', '/public/products?limit=1000')).statusCode).toBe(400);
    });

    it('members see their discounted price and no staff-only fields; staff see stock fields', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const p = await makeProduct({ pricePaise: 10000, stockQty: 1, reorderLevel: 5, sku: `MEM-${randomUUID()}` });

      const asMember = await call(memberA, 'GET', `/products?q=${p.sku}`);
      const asGuestMember = await call(memberB, 'GET', `/products/${p.id}`);
      const asStaff = await call(desk, 'GET', `/products?q=${p.sku}`);

      const m = asMember.json().data[0];
      expect(m.yourPricePaise).toBe(8500);
      expect(m.discountPct).toBe(15);
      expect(m).not.toHaveProperty('lowStock');
      expect(m).not.toHaveProperty('reorderLevel');
      expect(m).not.toHaveProperty('isActive');
      expect(asGuestMember.json().yourPricePaise).toBe(10000);
      const s = asStaff.json().data[0];
      expect(s).toMatchObject({ lowStock: true, reorderLevel: 5, isActive: true, stockQty: 1 });
    });

    it('inactive products are hidden from members but visible to staff; lowStock filter is staff-only', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const hidden = await makeProduct({ isActive: false, sku: `OFF-${randomUUID()}` });
      expect((await call(memberA, 'GET', `/products/${hidden.id}`)).statusCode).toBe(404);
      expect((await call(desk, 'GET', `/products/${hidden.id}`)).statusCode).toBe(200);

      const low = await makeProduct({ stockQty: 0, reorderLevel: 3, sku: `LOWF-${randomUUID()}` });
      const staffLow = await call(desk, 'GET', '/products?lowStock=true&limit=100');
      expect(staffLow.json().data.map((x: { id: string }) => x.id)).toContain(low.id);
      const memberLow = await call(memberA, 'GET', '/products?lowStock=true&limit=100');
      // The staff-only filter is ignored for members, who just get the normal catalogue.
      expect(memberLow.statusCode).toBe(200);
      const inStockOnly = await call(memberA, 'GET', '/products?inStock=true&limit=100');
      expect(inStockOnly.json().data.map((x: { id: string }) => x.id)).not.toContain(low.id);
    });

    it('owner creates and edits products; duplicate SKU is a 409; opening stock writes a movement', async (ctx) => {
      if (!hasDatabase) return ctx.skip();
      const sku = `NEW-${randomUUID()}`;
      const created = await call(owner, 'POST', '/products', {
        sku,
        name: 'New Racket',
        category: 'RACKET',
        pricePaise: 99900,
        stockQty: 7,
        reorderLevel: 2,
      });
      expect(created.statusCode).toBe(201);
      const p = ProductSchema.parse(created.json());
      productIds.push(p.id);
      expect(p).toMatchObject({ stockQty: 7, reorderLevel: 2, inStock: true, lowStock: false });
      const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.productId, p.id));
      expect(mv).toMatchObject({ qtyDelta: 7, balanceAfter: 7 });

      const dup = await call(owner, 'POST', '/products', { sku, name: 'Dup', category: 'RACKET', pricePaise: 1, stockQty: 0 });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('SKU_EXISTS');

      const edited = await call(owner, 'PUT', `/products/${p.id}`, { name: 'Renamed', pricePaise: 88800 });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({ name: 'Renamed', pricePaise: 88800, stockQty: 7 });
      // stock cannot be changed through PUT
      const sneaky = await call(owner, 'PUT', `/products/${p.id}`, { stockQty: 9999 });
      expect(await stockOf(p.id)).toBe(7);
      expect([200, 400]).toContain(sneaky.statusCode);
      expect((await call(owner, 'PUT', `/products/${randomUUID()}`, { name: 'x' })).statusCode).toBe(404);
    });
  });
});
