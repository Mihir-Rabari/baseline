import { tenantIdColumn } from './_tenant.js';
import { pgTable, varchar, text, uuid, smallint, integer, boolean, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { members } from './members.js';
import { pk, tstz, createdAt, updatedAt, paise } from './_columns.js';

/** A `categories.code` in the PRODUCT scope. */
export type ProductCategory = string;
export type OrderChannel = 'POS' | 'ONLINE';
export type Fulfilment = 'COUNTER' | 'PICKUP' | 'DELIVERY';
export type OrderStatus =
  | 'COMPLETED'
  | 'PLACED'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'COLLECTED'
  | 'DELIVERED'
  | 'CANCELLED';
export type StockReason = 'SALE_COUNTER' | 'SALE_ONLINE' | 'RESTOCK' | 'ADJUSTMENT' | 'CANCEL_RETURN';

export const products = pgTable(
  'products',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    sku: varchar('sku', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 24 }).$type<ProductCategory>().notNull(),
    description: text('description'),
    imageUrl: varchar('image_url', { length: 512 }),
    pricePaise: paise('price_paise').notNull(),
    discountable: boolean('discountable').notNull().default(true),
    stockQty: integer('stock_qty').notNull().default(0), // SQL CHECK (stock_qty >= 0)
    reorderLevel: integer('reorder_level').notNull().default(5),
    lowStockAlertedAt: tstz('low_stock_alerted_at'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('idx_products_category').on(t.category), index('idx_products_stock').on(t.stockQty)]
);

export const orders = pgTable(
  'orders',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    orderNumber: varchar('order_number', { length: 20 }).notNull().unique(), // ORD-000123 from order_number_seq
    channel: varchar('channel', { length: 12 }).$type<OrderChannel>().notNull(),
    memberId: uuid('member_id').references(() => members.id),
    customerName: varchar('customer_name', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 20 }),
    fulfilment: varchar('fulfilment', { length: 12 }).$type<Fulfilment>().notNull().default('COUNTER'),
    deliveryAddress: text('delivery_address'),
    deliveryFeePaise: paise('delivery_fee_paise').notNull().default(0),
    status: varchar('status', { length: 20 }).$type<OrderStatus>().notNull().default('COMPLETED'),
    subtotalPaise: paise('subtotal_paise').notNull(), // list prices
    discountPaise: paise('discount_paise').notNull().default(0),
    totalPaise: paise('total_paise').notNull(), // subtotal - discount + delivery fee
    paymentStatus: varchar('payment_status', { length: 12 })
      .$type<'UNPAID' | 'PAID' | 'REFUNDED'>()
      .notNull()
      .default('UNPAID'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_orders_status').on(t.status, t.createdAt),
    index('idx_orders_member').on(t.memberId),
    index('idx_orders_created').on(t.createdAt),
  ]
);

export const orderItems = pgTable(
  'order_items',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    productId: uuid('product_id')
      .references(() => products.id)
      .notNull(),
    nameSnapshot: varchar('name_snapshot', { length: 255 }).notNull(),
    qty: integer('qty').notNull(), // SQL CHECK (qty > 0)
    unitPricePaise: paise('unit_price_paise').notNull(),
    discountPct: smallint('discount_pct').notNull().default(0),
    lineTotalPaise: paise('line_total_paise').notNull(),
  },
  (t) => [index('idx_order_items_order').on(t.orderId), index('idx_order_items_product').on(t.productId)]
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    productId: uuid('product_id')
      .references(() => products.id)
      .notNull(),
    qtyDelta: integer('qty_delta').notNull(), // negative for sales
    balanceAfter: integer('balance_after').notNull(),
    reason: varchar('reason', { length: 24 }).$type<StockReason>().notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    note: text('note'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_stock_movements_product').on(t.productId, t.createdAt)]
);
