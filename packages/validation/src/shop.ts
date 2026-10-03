import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema } from './common.js';
import { CategoryCodeSchema } from './categories.js';
import { ImageRefSchema } from './uploads.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import {
  PaiseSchema,
  NonNegativePaiseSchema,
  PctSchema,
  MemberRefSchema,
  PaymentMethodSchema,
  PaymentReceiptSchema,
  RefundSchema,
} from './domain-common.js';

/** A PRODUCT-scope category code; the API checks it against the managed `categories` list. */
export const ProductCategoryEnum = CategoryCodeSchema;
export type ProductCategory = z.infer<typeof ProductCategoryEnum>;

/** Staff-only fields (lowStock, reorderLevel, isActive) are optional so member/public views validate. */
export const ProductSchema = z.object({
  id: UuidSchema,
  sku: z.string(),
  name: z.string(),
  category: ProductCategoryEnum,
  imageUrl: z.string().nullable(),
  pricePaise: PaiseSchema,
  yourPricePaise: PaiseSchema,
  discountPct: PctSchema,
  stockQty: z.number().int(),
  inStock: z.boolean(),
  lowStock: z.boolean().optional(),
  reorderLevel: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

export const ProductPageSchema = createPaginatedResponseSchema(ProductSchema);

/** GET /public/products items: no stock counts or staff fields. */
export const PublicProductSchema = z.object({
  id: UuidSchema,
  sku: z.string(),
  name: z.string(),
  category: ProductCategoryEnum,
  imageUrl: z.string().nullable(),
  pricePaise: PaiseSchema,
  inStock: z.boolean(),
});
export type PublicProduct = z.infer<typeof PublicProductSchema>;
export const PublicProductPageSchema = createPaginatedResponseSchema(PublicProductSchema);

const booleanQueryString = z.enum(['true', 'false']);

/** GET /products */
export const ProductListQuerySchema = PaginationQuerySchema.extend({
  category: ProductCategoryEnum.optional(),
  q: z.string().trim().optional(),
  lowStock: booleanQueryString.optional(),
  inStock: booleanQueryString.optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

/** GET /public/products */
export const PublicProductListQuerySchema = PaginationQuerySchema.extend({
  category: ProductCategoryEnum.optional(),
  q: z.string().trim().optional(),
});
export type PublicProductListQuery = z.infer<typeof PublicProductListQuerySchema>;

/** POST /products */
export const CreateProductRequestSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  category: ProductCategoryEnum,
  pricePaise: NonNegativePaiseSchema,
  stockQty: z.number().int().min(0),
  reorderLevel: z.number().int().min(0).optional(),
  imageUrl: ImageRefSchema.nullable().optional(),
  description: z.string().max(2000).optional(),
  discountable: z.boolean().optional(),
});
export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

/** PUT /products/:id: any subset except stockQty. */
export const UpdateProductRequestSchema = CreateProductRequestSchema.omit({ stockQty: true })
  .extend({
    isActive: z.boolean().optional(),
  })
  .partial();
export type UpdateProductRequest = z.infer<typeof UpdateProductRequestSchema>;

// ---- Inventory ----

/** POST /products/:id/restock */
export const RestockRequestSchema = z.object({
  qty: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
});
export type RestockRequest = z.infer<typeof RestockRequestSchema>;

/** POST /products/:id/adjust */
export const AdjustStockRequestSchema = z.object({
  qtyDelta: z.number().int().refine((v) => v !== 0, 'qtyDelta must be non-zero'),
  note: z.string().trim().min(1).max(500),
});
export type AdjustStockRequest = z.infer<typeof AdjustStockRequestSchema>;

export const StockMovementReasonEnum = z.enum(['RESTOCK', 'ADJUSTMENT']);

export const StockChangeResponseSchema = z.object({
  product: ProductSchema,
  movement: z.object({
    id: UuidSchema,
    qtyDelta: z.number().int(),
    balanceAfter: z.number().int(),
    reason: z.string(),
  }),
});
export type StockChangeResponse = z.infer<typeof StockChangeResponseSchema>;

/** GET /products/:id/movements items */
export const StockMovementSchema = z.object({
  id: UuidSchema,
  qtyDelta: z.number().int(),
  balanceAfter: z.number().int(),
  reason: z.string(),
  orderNumber: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: IsoDateTimeOutSchema,
});
export type StockMovement = z.infer<typeof StockMovementSchema>;
export const StockMovementPageSchema = createPaginatedResponseSchema(StockMovementSchema);
export type StockMovementPage = z.infer<typeof StockMovementPageSchema>;
export const StockMovementListQuerySchema = PaginationQuerySchema.pick({ page: true, limit: true });

/** GET /inventory/low-stock items */
export const LowStockItemSchema = z.object({
  product: ProductSchema,
  shortBy: z.number().int(),
});
export type LowStockItem = z.infer<typeof LowStockItemSchema>;
export const LowStockListSchema = z.array(LowStockItemSchema);

// ---- Orders ----

export const OrderChannelEnum = z.enum(['POS', 'ONLINE']);
export const OrderFulfilmentEnum = z.enum(['COUNTER', 'PICKUP', 'DELIVERY']);
export const OrderStatusEnum = z.enum([
  'COMPLETED',
  'PLACED',
  'READY',
  'OUT_FOR_DELIVERY',
  'COLLECTED',
  'DELIVERED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export const OrderPaymentStatusEnum = z.enum(['UNPAID', 'PAID', 'REFUNDED']);

export const OrderItemSchema = z.object({
  productId: UuidSchema,
  name: z.string(),
  qty: z.number().int().positive(),
  unitPricePaise: PaiseSchema,
  discountPct: PctSchema,
  lineTotalPaise: PaiseSchema,
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: UuidSchema,
  orderNumber: z.string(),
  channel: OrderChannelEnum,
  fulfilment: OrderFulfilmentEnum,
  status: OrderStatusEnum,
  member: MemberRefSchema.nullable(),
  customerName: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  items: z.array(OrderItemSchema),
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  deliveryFeePaise: PaiseSchema,
  totalPaise: PaiseSchema,
  paymentStatus: OrderPaymentStatusEnum,
  createdAt: IsoDateTimeOutSchema,
});
export type Order = z.infer<typeof OrderSchema>;
export const OrderPageSchema = createPaginatedResponseSchema(OrderSchema);

const OrderLineRequestSchema = z.object({
  productId: UuidSchema,
  qty: z.number().int().positive().max(1000),
});

/** POST /orders/quote */
export const QuoteOrderRequestSchema = z.object({
  memberId: UuidSchema.optional(),
  items: z.array(OrderLineRequestSchema).min(1).max(100),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']).optional(),
});
export type QuoteOrderRequest = z.infer<typeof QuoteOrderRequestSchema>;

export const QuoteOrderResponseSchema = z.object({
  items: z.array(
    z.object({
      productId: UuidSchema,
      name: z.string(),
      qty: z.number().int().positive(),
      unitPricePaise: PaiseSchema,
      discountPct: PctSchema,
      lineTotalPaise: PaiseSchema,
      inStock: z.boolean(),
    }),
  ),
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  deliveryFeePaise: PaiseSchema,
  totalPaise: PaiseSchema,
  discountPct: PctSchema,
});
export type QuoteOrderResponse = z.infer<typeof QuoteOrderResponseSchema>;

/** POST /orders/pos */
export const PosOrderRequestSchema = z.object({
  memberId: UuidSchema.optional(),
  customerName: z.string().trim().max(200).optional(),
  items: z.array(OrderLineRequestSchema).min(1).max(100),
  paymentMethod: PaymentMethodSchema,
});
export type PosOrderRequest = z.infer<typeof PosOrderRequestSchema>;

/** POST /orders/online (deliveryAddress required for DELIVERY) */
export const OnlineOrderRequestSchema = z
  .object({
    items: z.array(OrderLineRequestSchema).min(1).max(100),
    fulfilment: z.enum(['PICKUP', 'DELIVERY']),
    deliveryAddress: z.string().trim().min(1).max(500).optional(),
    payNow: z.object({ method: z.enum(['UPI', 'CARD']) }).optional(),
  })
  .refine((v) => v.fulfilment !== 'DELIVERY' || Boolean(v.deliveryAddress), {
    message: 'deliveryAddress is required for DELIVERY',
    path: ['deliveryAddress'],
  });
export type OnlineOrderRequest = z.infer<typeof OnlineOrderRequestSchema>;

/** GET /orders */
export const OrderListQuerySchema = PaginationQuerySchema.extend({
  status: OrderStatusEnum.optional(),
  channel: OrderChannelEnum.optional(),
  fulfilment: OrderFulfilmentEnum.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

/** GET /me/orders */
export const MyOrdersQuerySchema = PaginationQuerySchema.pick({ page: true, limit: true });

/** PATCH /orders/:id/status */
export const UpdateOrderStatusRequestSchema = z.object({
  status: z.enum(['READY', 'COLLECTED', 'OUT_FOR_DELIVERY', 'DELIVERED']),
});
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusRequestSchema>;

/** POST /orders/:id/pay */
export const PayOrderRequestSchema = z.object({
  method: PaymentMethodSchema,
  reference: z.string().trim().max(100).optional(),
});
export type PayOrderRequest = z.infer<typeof PayOrderRequestSchema>;

export const PayOrderResponseSchema = z.object({
  order: OrderSchema,
  payment: PaymentReceiptSchema.extend({ paidAt: IsoDateTimeOutSchema.optional() }),
});
export type PayOrderResponse = z.infer<typeof PayOrderResponseSchema>;

/** POST /orders/:id/cancel */
export const CancelOrderRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelOrderRequest = z.infer<typeof CancelOrderRequestSchema>;

export const CancelOrderResponseSchema = z.object({
  order: OrderSchema,
  stockReturned: z.array(z.object({ productId: UuidSchema, qty: z.number().int() })),
  refund: RefundSchema.nullable(),
});
export type CancelOrderResponse = z.infer<typeof CancelOrderResponseSchema>;
