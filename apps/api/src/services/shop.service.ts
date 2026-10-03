import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  members,
  memberships,
  orderItems,
  orders,
  plans,
  products,
  stockMovements,
  systemSettings,
  type DatabaseInstance,
  type Fulfilment,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
  type StockReason,
} from '@packages/db';
import { getEnv } from '@packages/config/env';
import { DomainError } from '../lib/domain-error.js';
import type { DbExecutor } from './db-types.js';
import { NotificationService } from './notification.service.js';
import { PaymentService } from './payment.service.js';

export type ProductRow = typeof products.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;

/** Roles that receive stock and online order notifications. */
export const SHOP_STAFF_ROLES = ['OWNER', 'FRONT_DESK'];

const DEFAULT_DELIVERY_FEE_PAISE = 5000;
const ORDER_NUMBER_PAD = 6;

export interface OrderLineInput {
  productId: string;
  qty: number;
}

export interface MemberRef {
  id: string;
  memberCode: string;
  fullName: string;
}

/** Who is buying: a member (gets the plan discount) or nobody (list price). */
export interface Customer {
  member: MemberRef | null;
  discountPct: number;
}

export interface PricedLine {
  productId: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  lineTotalPaise: number;
  listTotalPaise: number;
}

export interface Pricing {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  discountPct: number;
}

export interface PlaceOrderInput {
  channel: OrderChannel;
  customer: Customer;
  items: OrderLineInput[];
  fulfilment?: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  customerName?: string;
  /** POS: always paid at the counter. ONLINE: only when the member pays now. */
  payment?: { method: PaymentMethod; reference?: string };
  actorUserId: string | null;
}

export interface ListProductsQuery {
  category?: ProductRow['category'];
  q?: string;
  lowStock?: boolean;
  inStock?: boolean;
  page: number;
  limit: number;
}

export interface ListOrdersQuery {
  status?: OrderStatus;
  channel?: OrderChannel;
  fulfilment?: Fulfilment;
  from?: string;
  to?: string;
  memberId?: string;
  page: number;
  limit: number;
}

export interface Page<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export function pageOf<T>(data: T[], page: number, limit: number, total: number): Page<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    meta: {
      page,
      limit,
      totalItems: total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/** Price of one unit for a customer with `discountPct`, rounded to the nearest paisa. */
export function unitPriceFor(product: Pick<ProductRow, 'pricePaise' | 'discountable'>, discountPct: number): number {
  return product.discountable ? Math.round((product.pricePaise * (100 - discountPct)) / 100) : product.pricePaise;
}

/**
 * The single pricing function. quote() and placeOrder() both call it, so the preview a
 * customer sees can never differ from what is charged (BR-14).
 */
export function priceOrder(
  rows: Map<string, ProductRow>,
  items: OrderLineInput[],
  discountPct: number,
  deliveryFeePaise: number
): Pricing {
  const lines: PricedLine[] = items.map((item) => {
    const p = rows.get(item.productId)!;
    const linePct = p.discountable ? discountPct : 0;
    const listTotalPaise = p.pricePaise * item.qty;
    const lineTotalPaise = Math.round((listTotalPaise * (100 - linePct)) / 100);
    return {
      productId: p.id,
      name: p.name,
      qty: item.qty,
      unitPricePaise: p.pricePaise,
      discountPct: linePct,
      lineTotalPaise,
      listTotalPaise,
    };
  });
  const subtotalPaise = lines.reduce((s, l) => s + l.listTotalPaise, 0);
  const afterDiscount = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  return {
    lines,
    subtotalPaise,
    discountPaise: subtotalPaise - afterDiscount,
    deliveryFeePaise,
    totalPaise: afterDiscount + deliveryFeePaise,
    discountPct,
  };
}

/** Merges duplicate product ids and sorts by id: the global lock order (no deadlocks). */
export function normaliseItems(items: OrderLineInput[]): OrderLineInput[] {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.qty);
  return [...merged.entries()]
    .map(([productId, qty]) => ({ productId, qty }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

function notFound(message: string): DomainError {
  return new DomainError('NOT_FOUND', 404, message);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const STATUS_TRANSITIONS: Record<
  'READY' | 'COLLECTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED',
  { from: OrderStatus; fulfilment: Fulfilment }
> = {
  READY: { from: 'PLACED', fulfilment: 'PICKUP' },
  COLLECTED: { from: 'READY', fulfilment: 'PICKUP' },
  OUT_FOR_DELIVERY: { from: 'PLACED', fulfilment: 'DELIVERY' },
  DELIVERED: { from: 'OUT_FOR_DELIVERY', fulfilment: 'DELIVERY' },
};

export class ShopService {
  private readonly timezone: string;

  constructor(
    private readonly db: DatabaseInstance,
    options: { timezone?: string } = {}
  ) {
    this.timezone = options.timezone ?? getEnv().CLUB_TIMEZONE;
  }

  // ---------------------------------------------------------------------------
  // Customers and discounts
  // ---------------------------------------------------------------------------

  /** `yyyy-mm-dd` of `at` in the club time zone. */
  clubDate(at: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }

  /**
   * Resolves the buyer and their discount. The percentage is read from the member's ACTIVE
   * plan that covers today (club time); it is never taken from the client.
   */
  async resolveCustomer(
    by: { memberId?: string; userId?: string },
    exec: DbExecutor = this.db
  ): Promise<Customer> {
    if (!by.memberId && !by.userId) return { member: null, discountPct: 0 };
    const [member] = await exec
      .select({ id: members.id, memberCode: members.memberCode, fullName: members.fullName })
      .from(members)
      .where(by.memberId ? eq(members.id, by.memberId) : eq(members.userId, by.userId!))
      .limit(1);
    if (!member) {
      if (by.memberId) throw notFound('Member not found');
      return { member: null, discountPct: 0 };
    }
    const today = this.clubDate();
    const [plan] = await exec
      .select({ pct: plans.shopDiscountPct })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(
        and(
          eq(memberships.memberId, member.id),
          eq(memberships.status, 'ACTIVE'),
          sql`${memberships.startsOn} <= ${today}`,
          sql`${memberships.endsOn} >= ${today}`
        )
      )
      .limit(1);
    return { member, discountPct: plan?.pct ?? 0 };
  }

  private async deliveryFee(exec: DbExecutor): Promise<number> {
    const [row] = await exec
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, 'shop.delivery_fee_paise'))
      .limit(1);
    const n = Number(row?.value);
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DELIVERY_FEE_PAISE;
  }

  // ---------------------------------------------------------------------------
  // Quote and placeOrder
  // ---------------------------------------------------------------------------

  /** Read-only price preview. Does not touch stock. */
  async quote(input: { customer: Customer; items: OrderLineInput[]; fulfilment?: 'PICKUP' | 'DELIVERY' }) {
    const items = normaliseItems(input.items);
    const rows = await this.db
      .select()
      .from(products)
      .where(
        inArray(
          products.id,
          items.map((i) => i.productId)
        )
      );
    const byId = new Map(rows.filter((r) => r.isActive).map((r) => [r.id, r]));
    const missing = items.filter((i) => !byId.has(i.productId));
    if (missing.length) {
      throw new DomainError(
        'NOT_FOUND',
        404,
        'One or more products were not found',
        missing.map((m) => ({ field: 'items.productId', message: `unknown product ${m.productId}`, code: 'NOT_FOUND' }))
      );
    }
    const fee = input.fulfilment === 'DELIVERY' ? await this.deliveryFee(this.db) : 0;
    const pricing = priceOrder(byId, items, input.customer.discountPct, fee);
    return {
      items: pricing.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unitPricePaise: l.unitPricePaise,
        discountPct: l.discountPct,
        lineTotalPaise: l.lineTotalPaise,
        inStock: byId.get(l.productId)!.stockQty >= l.qty,
      })),
      subtotalPaise: pricing.subtotalPaise,
      discountPaise: pricing.discountPaise,
      deliveryFeePaise: pricing.deliveryFeePaise,
      totalPaise: pricing.totalPaise,
      discountPct: pricing.discountPct,
    };
  }

  /**
   * The only code path that sells stock (BR-13): counter POS and online orders both land
   * here. One transaction: lock products in id order, check stock, guarded decrement,
   * stock_movements, order rows, payment row, notifications.
   */
  async placeOrder(input: PlaceOrderInput) {
    const items = normaliseItems(input.items);
    const isPos = input.channel === 'POS';
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(products)
        .where(
          inArray(
            products.id,
            items.map((i) => i.productId)
          )
        )
        .orderBy(asc(products.id))
        .for('update');
      const byId = new Map(locked.filter((r) => r.isActive).map((r) => [r.id, r]));

      const missing = items.filter((i) => !byId.has(i.productId));
      if (missing.length) {
        throw new DomainError(
          'NOT_FOUND',
          404,
          'One or more products were not found',
          missing.map((m) => ({ field: 'items.productId', message: `unknown product ${m.productId}`, code: 'NOT_FOUND' }))
        );
      }
      const short = items.filter((i) => byId.get(i.productId)!.stockQty < i.qty);
      if (short.length) this.throwOutOfStock(short, byId, input.items);

      const fee = !isPos && input.fulfilment === 'DELIVERY' ? await this.deliveryFee(tx) : 0;
      const pricing = priceOrder(byId, items, input.customer.discountPct, fee);

      const [seq] = await tx.execute<{ n: string }>(sql`select nextval('order_number_seq') as n`);
      const orderNumber = `ORD-${String(seq.n).padStart(ORDER_NUMBER_PAD, '0')}`;
      const paidNow = isPos || Boolean(input.payment);

      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          channel: input.channel,
          memberId: input.customer.member?.id ?? null,
          customerName: input.customerName ?? null,
          fulfilment: isPos ? 'COUNTER' : (input.fulfilment ?? 'PICKUP'),
          deliveryAddress: !isPos && input.fulfilment === 'DELIVERY' ? (input.deliveryAddress ?? null) : null,
          deliveryFeePaise: pricing.deliveryFeePaise,
          status: isPos ? 'COMPLETED' : 'PLACED',
          subtotalPaise: pricing.subtotalPaise,
          discountPaise: pricing.discountPaise,
          totalPaise: pricing.totalPaise,
          paymentStatus: paidNow ? 'PAID' : 'UNPAID',
          createdBy: input.actorUserId,
        })
        .returning();

      await tx.insert(orderItems).values(
        pricing.lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          nameSnapshot: l.name,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct,
          lineTotalPaise: l.lineTotalPaise,
        }))
      );

      for (const line of items) {
        await this.changeStock(tx, {
          productId: line.productId,
          delta: -line.qty,
          reason: isPos ? 'SALE_COUNTER' : 'SALE_ONLINE',
          orderId: order.id,
          actorUserId: input.actorUserId,
          requireActive: true,
        });
      }

      if (paidNow && input.payment && pricing.totalPaise > 0) {
        await new PaymentService(tx).record({
          source: 'SHOP',
          sourceId: order.id,
          amountPaise: pricing.totalPaise,
          method: input.payment.method,
          memberId: input.customer.member?.id ?? null,
          receivedBy: isPos ? input.actorUserId : null,
          reference: input.payment.reference ?? null,
        });
      }

      if (!isPos) {
        await new NotificationService(tx).notifyRole(
          SHOP_STAFF_ROLES,
          {
            type: 'ONLINE_ORDER',
            title: `New online order ${orderNumber}`,
            body: `${input.fulfilment === 'DELIVERY' ? 'Delivery' : 'Pickup'} order, total ${pricing.totalPaise} paise`,
            link: `/shop/orders/${order.id}`,
            data: { orderId: order.id, orderNumber },
          },
          `online-order:${order.id}`
        );
      }

      return this.loadOrderDto(tx, order.id);
    });
  }

  private throwOutOfStock(short: OrderLineInput[], byId: Map<string, ProductRow>, original: OrderLineInput[]): never {
    const first = byId.get(short[0].productId)!;
    throw new DomainError(
      'OUT_OF_STOCK',
      409,
      `Not enough stock for ${first.name}: ${first.stockQty} left.`,
      short.map((s) => {
        const idx = original.findIndex((o) => o.productId === s.productId);
        return {
          field: `items[${Math.max(idx, 0)}].productId`,
          message: `requested ${s.qty}, available ${byId.get(s.productId)!.stockQty}`,
          code: 'OUT_OF_STOCK',
        };
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Stock: one guarded change function for sales, restock and adjustments
  // ---------------------------------------------------------------------------

  /**
   * Applies `delta` to a product with a guarded UPDATE (`stock_qty + delta >= 0`), writes
   * the stock_movements row with `balance_after`, and manages the low-stock flag:
   * crossing to or below the reorder level raises it (and notifies once per crossing);
   * rising above the level clears it, so the next drop alerts again.
   */
  private async changeStock(
    tx: DbExecutor,
    opts: {
      productId: string;
      delta: number;
      reason: StockReason;
      orderId?: string;
      note?: string | null;
      actorUserId: string | null;
      requireActive?: boolean;
    }
  ): Promise<{ product: ProductRow; movementId: string }> {
    const [current] = await tx
      .select()
      .from(products)
      .where(eq(products.id, opts.productId))
      .for('update');
    if (!current) throw notFound('Product not found');

    const newQty = current.stockQty + opts.delta;
    const crossing = newQty <= current.reorderLevel && current.lowStockAlertedAt === null;
    const recovered = newQty > current.reorderLevel;

    const [updated] = await tx
      .update(products)
      .set({
        stockQty: sql`${products.stockQty} + ${opts.delta}`,
        updatedAt: sql`now()`,
        lowStockAlertedAt: recovered ? null : crossing ? sql`now()` : current.lowStockAlertedAt,
      })
      .where(
        and(
          eq(products.id, opts.productId),
          sql`${products.stockQty} + ${opts.delta} >= 0`,
          opts.requireActive ? eq(products.isActive, true) : undefined
        )
      )
      .returning();
    if (!updated) {
      throw new DomainError('OUT_OF_STOCK', 409, `Not enough stock for ${current.name}: ${current.stockQty} left.`, [
        { field: 'productId', message: `requested ${-opts.delta}, available ${current.stockQty}`, code: 'OUT_OF_STOCK' },
      ]);
    }

    const [movement] = await tx
      .insert(stockMovements)
      .values({
        productId: updated.id,
        qtyDelta: opts.delta,
        balanceAfter: updated.stockQty,
        reason: opts.reason,
        orderId: opts.orderId ?? null,
        note: opts.note ?? null,
        actorUserId: opts.actorUserId,
      })
      .returning({ id: stockMovements.id });

    if (crossing) {
      await new NotificationService(tx).notifyRole(
        SHOP_STAFF_ROLES,
        {
          type: 'LOW_STOCK',
          title: `Low stock: ${updated.name}`,
          body: `${updated.stockQty} left (reorder level ${updated.reorderLevel})`,
          link: '/shop/inventory',
          data: { productId: updated.id, stockQty: updated.stockQty, reorderLevel: updated.reorderLevel },
        },
        // Per crossing: the movement id keeps a same-day restock-then-drop from being deduped away.
        `low-stock:${updated.id}:${this.clubDate()}:${movement.id.slice(0, 8)}`
      );
    }
    return { product: updated, movementId: movement.id };
  }

  async restock(productId: string, qty: number, note: string | undefined, actorUserId: string | null) {
    return this.db.transaction(async (tx) => {
      const { product, movementId } = await this.changeStock(tx, {
        productId,
        delta: qty,
        reason: 'RESTOCK',
        note,
        actorUserId,
      });
      return { product, movement: { id: movementId, qtyDelta: qty, balanceAfter: product.stockQty, reason: 'RESTOCK' } };
    });
  }

  async adjust(productId: string, qtyDelta: number, note: string, actorUserId: string | null) {
    return this.db.transaction(async (tx) => {
      try {
        const { product, movementId } = await this.changeStock(tx, {
          productId,
          delta: qtyDelta,
          reason: 'ADJUSTMENT',
          note,
          actorUserId,
        });
        return {
          product,
          movement: { id: movementId, qtyDelta, balanceAfter: product.stockQty, reason: 'ADJUSTMENT' },
        };
      } catch (err) {
        if (err instanceof DomainError && err.code === 'OUT_OF_STOCK') {
          throw new DomainError('STOCK_BELOW_ZERO', 409, 'That adjustment would take stock below zero.', err.details);
        }
        throw err;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------

  toProductDto(row: ProductRow, discountPct: number, staff: boolean) {
    const effectivePct = row.discountable ? discountPct : 0;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      imageUrl: row.imageUrl,
      pricePaise: row.pricePaise,
      yourPricePaise: unitPriceFor(row, discountPct),
      discountPct: effectivePct,
      stockQty: row.stockQty,
      inStock: row.isActive && row.stockQty > 0,
      ...(staff
        ? { lowStock: row.stockQty <= row.reorderLevel, reorderLevel: row.reorderLevel, isActive: row.isActive }
        : {}),
    };
  }

  toPublicProductDto(row: ProductRow) {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      imageUrl: row.imageUrl,
      pricePaise: row.pricePaise,
      inStock: row.isActive && row.stockQty > 0,
    };
  }

  private productFilters(q: Pick<ListProductsQuery, 'category' | 'q' | 'lowStock' | 'inStock'>, activeOnly: boolean) {
    const filters: SQL[] = [];
    if (activeOnly) filters.push(eq(products.isActive, true));
    if (q.category) filters.push(eq(products.category, q.category));
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      filters.push(or(ilike(products.name, like), ilike(products.sku, like))!);
    }
    if (q.lowStock) filters.push(sql`${products.stockQty} <= ${products.reorderLevel}`);
    if (q.inStock === true) filters.push(sql`${products.stockQty} > 0`);
    if (q.inStock === false) filters.push(sql`${products.stockQty} <= 0`);
    return and(...filters);
  }

  async listProducts(query: ListProductsQuery, viewer: { staff: boolean; discountPct: number }) {
    const where = this.productFilters(query, !viewer.staff);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(where)
        .orderBy(asc(products.name), asc(products.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(products).where(where),
    ]);
    return pageOf(
      rows.map((r) => this.toProductDto(r, viewer.discountPct, viewer.staff)),
      query.page,
      query.limit,
      Number(total?.n ?? 0)
    );
  }

  /** Public catalogue: active products, availability only, never a stock number. */
  async listPublicProducts(query: Pick<ListProductsQuery, 'category' | 'q' | 'page' | 'limit'>) {
    const where = this.productFilters(query, true);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(where)
        .orderBy(asc(products.name), asc(products.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(products).where(where),
    ]);
    return pageOf(
      rows.map((r) => this.toPublicProductDto(r)),
      query.page,
      query.limit,
      Number(total?.n ?? 0)
    );
  }

  async getProduct(id: string, viewer: { staff: boolean; discountPct: number }) {
    const [row] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!row || (!viewer.staff && !row.isActive)) throw notFound('Product not found');
    return this.toProductDto(row, viewer.discountPct, viewer.staff);
  }

  async createProduct(
    input: {
      sku: string;
      name: string;
      category: ProductRow['category'];
      pricePaise: number;
      stockQty: number;
      reorderLevel?: number;
      imageUrl?: string;
      description?: string;
      discountable?: boolean;
    },
    actorUserId: string | null
  ) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.sku, input.sku)).limit(1);
      if (existing) throw new DomainError('SKU_EXISTS', 409, `A product with SKU ${input.sku} already exists.`);
      const [row] = await tx
        .insert(products)
        .values({
          sku: input.sku,
          name: input.name,
          category: input.category,
          pricePaise: input.pricePaise,
          stockQty: input.stockQty,
          ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
          imageUrl: input.imageUrl ?? null,
          description: input.description ?? null,
          ...(input.discountable !== undefined ? { discountable: input.discountable } : {}),
        })
        .returning();
      if (row.stockQty > 0) {
        await tx.insert(stockMovements).values({
          productId: row.id,
          qtyDelta: row.stockQty,
          balanceAfter: row.stockQty,
          reason: 'RESTOCK',
          note: 'Opening stock',
          actorUserId,
        });
      }
      return this.toProductDto(row, 0, true);
    });
  }

  async updateProduct(
    id: string,
    patch: Partial<{
      sku: string;
      name: string;
      category: ProductRow['category'];
      pricePaise: number;
      reorderLevel: number;
      imageUrl: string;
      description: string;
      discountable: boolean;
    }>
  ) {
    return this.db.transaction(async (tx) => {
      if (patch.sku) {
        const [clash] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.sku, patch.sku), sql`${products.id} <> ${id}`))
          .limit(1);
        if (clash) throw new DomainError('SKU_EXISTS', 409, `A product with SKU ${patch.sku} already exists.`);
      }
      const [row] = await tx
        .update(products)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(products.id, id))
        .returning();
      if (!row) throw notFound('Product not found');
      return this.toProductDto(row, 0, true);
    });
  }

  async listMovements(productId: string, page: number, limit: number) {
    const [product] = await this.db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
    if (!product) throw notFound('Product not found');
    const where = eq(stockMovements.productId, productId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: stockMovements.id,
          qtyDelta: stockMovements.qtyDelta,
          balanceAfter: stockMovements.balanceAfter,
          reason: stockMovements.reason,
          note: stockMovements.note,
          createdAt: stockMovements.createdAt,
          orderNumber: orders.orderNumber,
        })
        .from(stockMovements)
        .leftJoin(orders, eq(orders.id, stockMovements.orderId))
        .where(where)
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: count() }).from(stockMovements).where(where),
    ]);
    return pageOf(rows, page, limit, Number(total?.n ?? 0));
  }

  async lowStock() {
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.isActive, true), sql`${products.stockQty} <= ${products.reorderLevel}`))
      .orderBy(sql`${products.stockQty} - ${products.reorderLevel} asc`, asc(products.name), asc(products.id));
    return rows.map((r) => ({
      product: this.toProductDto(r, 0, true),
      shortBy: r.reorderLevel - r.stockQty,
    }));
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  private async hydrate(exec: DbExecutor, rows: OrderRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const memberIds = [...new Set(rows.map((r) => r.memberId).filter((m): m is string => Boolean(m)))];
    const [items, memberRows] = await Promise.all([
      exec.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.productId)),
      memberIds.length
        ? exec
            .select({ id: members.id, memberCode: members.memberCode, fullName: members.fullName })
            .from(members)
            .where(inArray(members.id, memberIds))
        : Promise.resolve([] as MemberRef[]),
    ]);
    const memberById = new Map(memberRows.map((m) => [m.id, m]));
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      channel: o.channel,
      fulfilment: o.fulfilment,
      status: o.status,
      member: o.memberId ? (memberById.get(o.memberId) ?? null) : null,
      customerName: o.customerName,
      deliveryAddress: o.deliveryAddress,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          productId: i.productId,
          name: i.nameSnapshot,
          qty: i.qty,
          unitPricePaise: i.unitPricePaise,
          discountPct: i.discountPct,
          lineTotalPaise: i.lineTotalPaise,
        })),
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      deliveryFeePaise: o.deliveryFeePaise,
      totalPaise: o.totalPaise,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    }));
  }

  private async loadOrderDto(exec: DbExecutor, id: string) {
    const [row] = await exec.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!row) throw notFound('Order not found');
    const [dto] = await this.hydrate(exec, [row]);
    return dto;
  }

  async getOrder(id: string) {
    return this.loadOrderDto(this.db, id);
  }

  /**
   * Who owns an order, for authorization. `ownerUserId` is the login of the member who
   * placed it (null for walk-in sales and members without a login).
   */
  async getOrderAccess(id: string): Promise<{ ownerUserId: string | null } | null> {
    const [row] = await this.db
      .select({ ownerUserId: members.userId })
      .from(orders)
      .leftJoin(members, eq(members.id, orders.memberId))
      .where(eq(orders.id, id))
      .limit(1);
    return row ?? null;
  }

  private parseBoundary(value: string, which: 'from' | 'to'): SQL {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const day = sql`(${orders.createdAt} at time zone ${this.timezone})::date`;
      return which === 'from' ? sql`${day} >= ${value}::date` : sql`${day} <= ${value}::date`;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new DomainError('VALIDATION_ERROR', 400, `${which} must be a date (YYYY-MM-DD) or ISO timestamp`, [
        { field: which, message: 'invalid date', code: 'INVALID_DATE' },
      ]);
    }
    return which === 'from' ? gte(orders.createdAt, d) : lte(orders.createdAt, d);
  }

  async listOrders(query: ListOrdersQuery) {
    const filters: (SQL | undefined)[] = [
      query.status ? eq(orders.status, query.status) : undefined,
      query.channel ? eq(orders.channel, query.channel) : undefined,
      query.fulfilment ? eq(orders.fulfilment, query.fulfilment) : undefined,
      query.memberId ? eq(orders.memberId, query.memberId) : undefined,
      query.from ? this.parseBoundary(query.from, 'from') : undefined,
      query.to ? this.parseBoundary(query.to, 'to') : undefined,
    ];
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(orders)
        .where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(orders).where(where),
    ]);
    return pageOf(await this.hydrate(this.db, rows), query.page, query.limit, Number(total?.n ?? 0));
  }

  /** The caller's own orders. A user with no member profile has none. */
  async listMyOrders(userId: string, page: number, limit: number) {
    const [member] = await this.db.select({ id: members.id }).from(members).where(eq(members.userId, userId)).limit(1);
    if (!member) return pageOf([], page, limit, 0);
    return this.listOrders({ memberId: member.id, page, limit });
  }

  /**
   * Moves an order along its fulfilment flow with a guarded UPDATE on the current status,
   * so two concurrent clicks cannot both succeed.
   */
  async updateStatus(id: string, status: keyof typeof STATUS_TRANSITIONS) {
    const rule = STATUS_TRANSITIONS[status];
    const [updated] = await this.db
      .update(orders)
      .set({ status, updatedAt: sql`now()` })
      .where(and(eq(orders.id, id), eq(orders.status, rule.from), eq(orders.fulfilment, rule.fulfilment)))
      .returning({ id: orders.id });
    if (!updated) {
      const [existing] = await this.db
        .select({ status: orders.status, fulfilment: orders.fulfilment })
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);
      if (!existing) throw notFound('Order not found');
      throw new DomainError(
        'ORDER_STATE_INVALID',
        409,
        `A ${existing.fulfilment.toLowerCase()} order that is ${existing.status} cannot move to ${status}.`
      );
    }
    return this.loadOrderDto(this.db, id);
  }

  /** Records payment for an unpaid order. Guarded so it can only be paid once. */
  async payOrder(
    id: string,
    input: { method: PaymentMethod; reference?: string; receivedBy: string | null }
  ) {
    return this.db.transaction(async (tx) => {
      const [paid] = await tx
        .update(orders)
        .set({ paymentStatus: 'PAID', updatedAt: sql`now()` })
        .where(and(eq(orders.id, id), eq(orders.paymentStatus, 'UNPAID'), sql`${orders.status} <> 'CANCELLED'`))
        .returning();
      if (!paid) {
        const [existing] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
        if (!existing) throw notFound('Order not found');
        if (existing.paymentStatus === 'PAID') throw new DomainError('ALREADY_PAID', 409, 'This order is already paid.');
        throw new DomainError('ORDER_STATE_INVALID', 409, 'This order can no longer be paid.');
      }
      const payment = await new PaymentService(tx).record({
        source: 'SHOP',
        sourceId: paid.id,
        amountPaise: paid.totalPaise,
        method: input.method,
        memberId: paid.memberId,
        receivedBy: input.receivedBy,
        reference: input.reference ?? null,
      });
      const order = await this.loadOrderDto(tx, paid.id);
      return {
        order,
        payment: { id: payment.id, amountPaise: paid.totalPaise, method: input.method, paidAt: payment.paidAt },
      };
    });
  }
}
