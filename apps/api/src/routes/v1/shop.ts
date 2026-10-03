import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PolicyEngine, requirePermission, type IamService } from '@packages/iam';
import {
  AdjustStockRequestSchema,
  CreateProductRequestSchema,
  HttpErrorResponseSchema,
  LowStockListSchema,
  MyOrdersQuerySchema,
  OnlineOrderRequestSchema,
  OrderListQuerySchema,
  OrderPageSchema,
  OrderSchema,
  PayOrderRequestSchema,
  PayOrderResponseSchema,
  PosOrderRequestSchema,
  ProductListQuerySchema,
  ProductPageSchema,
  ProductSchema,
  PublicProductListQuerySchema,
  PublicProductPageSchema,
  QuoteOrderRequestSchema,
  QuoteOrderResponseSchema,
  RestockRequestSchema,
  StockChangeResponseSchema,
  StockMovementListQuerySchema,
  StockMovementPageSchema,
  UpdateOrderStatusRequestSchema,
  UpdateProductRequestSchema,
  UuidSchema,
} from '@packages/validation';
import { DomainError } from '../../lib/domain-error.js';
import { ShopService } from '../../services/shop.service.js';

const IdParamSchema = z.object({ id: UuidSchema });

function unauthorized(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(401).send({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Authentication required to access this resource',
    code: 'UNAUTHORIZED',
    requestId: request.id,
    timestamp: new Date().toISOString(),
  });
}

function forbidden(request: FastifyRequest, reply: FastifyReply, action: string) {
  return reply.status(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: `You do not have permission to perform '${action}'`,
    code: 'FORBIDDEN',
    requestId: request.id,
    timestamp: new Date().toISOString(),
  });
}

/** Evaluates one action for the caller; `ownerId` feeds the `:self` ownership check. */
async function can(request: FastifyRequest, action: string, ownerId?: string | null): Promise<boolean> {
  if (!request.user) return false;
  if (!request.effectiveStatements) {
    const iam = (request.server as unknown as { iamService: IamService }).iamService;
    request.effectiveStatements = await iam.getUserStatements(request.user.id);
  }
  return PolicyEngine.evaluate({
    identity: request.user,
    action,
    statements: request.effectiveStatements,
    context: ownerId ? { resourceOwnerId: ownerId } : undefined,
  }).allowed;
}

/** Allows staff holding `staffAction`, or a member acting on their own resources. */
function requireStaffOrSelf(staffAction: string, selfAction: string): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) return unauthorized(request, reply);
    if (await can(request, staffAction)) return;
    if (await can(request, selfAction, request.user.id)) return;
    return forbidden(request, reply, staffAction);
  };
}

const errorResponses = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  403: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema,
  409: HttpErrorResponseSchema,
};

export const shopRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const shop = new ShopService(fastify.db, { timezone: fastify.env.CLUB_TIMEZONE });

  const ownSelf = (action: string) => requirePermission(action, (req) => ({ resourceOwnerId: req.user?.id }));

  // ---------------------------------------------------------------------------
  // Public catalogue: availability only, never stock numbers
  // ---------------------------------------------------------------------------
  fastify.get(
    '/public/products',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        description: 'Public shop catalogue. Only an inStock flag is exposed, never stock counts.',
        tags: ['Public'],
        querystring: PublicProductListQuerySchema,
        response: { 200: PublicProductPageSchema, 400: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => reply.send(await shop.listPublicProducts(request.query))
  );

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------
  fastify.get(
    '/products',
    {
      preHandler: [requireStaffOrSelf('products:read', 'orders:read:self')],
      schema: {
        description: "Shop products. Prices use the caller's plan discount; staff also get stock fields.",
        tags: ['Shop'],
        querystring: ProductListQuerySchema,
        response: { 200: ProductPageSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const staff = await can(request, 'products:read');
      const customer = await shop.resolveCustomer({ userId: request.user!.id });
      const { lowStock, inStock, ...rest } = request.query;
      // Low-stock is staff-only information.
      const result = await shop.listProducts(
        {
          ...rest,
          lowStock: staff && lowStock !== undefined ? lowStock === 'true' : undefined,
          inStock: inStock !== undefined ? inStock === 'true' : undefined,
        },
        { staff, discountPct: customer.discountPct }
      );
      return reply.send(result);
    }
  );

  fastify.get(
    '/products/:id',
    {
      preHandler: [requireStaffOrSelf('products:read', 'orders:read:self')],
      schema: {
        description: 'One product',
        tags: ['Shop'],
        params: IdParamSchema,
        response: { 200: ProductSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const staff = await can(request, 'products:read');
      const customer = await shop.resolveCustomer({ userId: request.user!.id });
      return reply.send(await shop.getProduct(request.params.id, { staff, discountPct: customer.discountPct }));
    }
  );

  fastify.post(
    '/products',
    {
      preHandler: [requirePermission('products:create')],
      schema: {
        description: 'Create a product (owner)',
        tags: ['Shop'],
        body: CreateProductRequestSchema,
        response: { 201: ProductSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.status(201).send(await shop.createProduct(request.body, request.user!.id))
  );

  fastify.put(
    '/products/:id',
    {
      preHandler: [requirePermission('products:update')],
      schema: {
        description: 'Update product details (owner). Stock changes go through restock or adjust.',
        tags: ['Shop'],
        params: IdParamSchema,
        body: UpdateProductRequestSchema,
        response: { 200: ProductSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.send(await shop.updateProduct(request.params.id, request.body))
  );

  fastify.post(
    '/products/:id/restock',
    {
      preHandler: [requirePermission('inventory:adjust')],
      schema: {
        description: 'Add stock (front desk, owner). Clears the low-stock flag when above the reorder level.',
        tags: ['Inventory'],
        params: IdParamSchema,
        body: RestockRequestSchema,
        response: { 200: StockChangeResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { product, movement } = await shop.restock(
        request.params.id,
        request.body.qty,
        request.body.note,
        request.user!.id
      );
      return reply.send({ product: shop.toProductDto(product, 0, true), movement });
    }
  );

  fastify.post(
    '/products/:id/adjust',
    {
      preHandler: [requirePermission('products:update')],
      schema: {
        description: 'Correct stock by a signed amount with a required note (owner)',
        tags: ['Inventory'],
        params: IdParamSchema,
        body: AdjustStockRequestSchema,
        response: { 200: StockChangeResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { product, movement } = await shop.adjust(
        request.params.id,
        request.body.qtyDelta,
        request.body.note,
        request.user!.id
      );
      return reply.send({ product: shop.toProductDto(product, 0, true), movement });
    }
  );

  fastify.get(
    '/products/:id/movements',
    {
      preHandler: [requirePermission('inventory:read')],
      schema: {
        description: 'Stock ledger for a product',
        tags: ['Inventory'],
        params: IdParamSchema,
        querystring: StockMovementListQuerySchema,
        response: { 200: StockMovementPageSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.send(await shop.listMovements(request.params.id, request.query.page, request.query.limit))
  );

  fastify.get(
    '/inventory/low-stock',
    {
      preHandler: [requirePermission('inventory:read')],
      schema: {
        description: 'Products at or below their reorder level, most urgent first',
        tags: ['Inventory'],
        response: { 200: LowStockListSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (_request, reply) => reply.send(await shop.lowStock())
  );

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------
  fastify.post(
    '/orders/quote',
    {
      preHandler: [requireStaffOrSelf('orders:create', 'orders:create:self')],
      schema: {
        description: 'Price preview with the member discount computed server-side. Does not touch stock.',
        tags: ['Shop'],
        body: QuoteOrderRequestSchema,
        response: { 200: QuoteOrderResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const staff = await can(request, 'orders:create');
      const { memberId, items, fulfilment } = request.body;
      let customer;
      if (staff) {
        customer = memberId ? await shop.resolveCustomer({ memberId }) : { member: null, discountPct: 0 };
      } else {
        customer = await shop.resolveCustomer({ userId: request.user!.id });
        // A member can only ever be quoted as themselves.
        if (memberId && memberId !== customer.member?.id) return forbidden(request, reply, 'orders:create');
      }
      return reply.send(await shop.quote({ customer, items, fulfilment }));
    }
  );

  fastify.post(
    '/orders/pos',
    {
      preHandler: [requirePermission('orders:create')],
      schema: {
        description: 'Counter sale (front desk, owner): decrements stock and records the payment',
        tags: ['Shop'],
        body: PosOrderRequestSchema,
        response: { 201: OrderSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { memberId, customerName, items, paymentMethod } = request.body;
      const customer = memberId
        ? await shop.resolveCustomer({ memberId })
        : { member: null, discountPct: 0 };
      const order = await shop.placeOrder({
        channel: 'POS',
        customer,
        items,
        customerName,
        payment: { method: paymentMethod },
        actorUserId: request.user!.id,
      });
      request.log.info({ orderId: order.id, orderNumber: order.orderNumber, channel: 'POS' }, 'Order placed');
      return reply.status(201).send(order);
    }
  );

  fastify.post(
    '/orders/online',
    {
      preHandler: [ownSelf('orders:create:self')],
      schema: {
        description: 'Member online order: stock is reserved at placement',
        tags: ['Shop'],
        body: OnlineOrderRequestSchema,
        response: { 201: OrderSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const customer = await shop.resolveCustomer({ userId: request.user!.id });
      if (!customer.member) {
        throw new DomainError('MEMBER_PROFILE_REQUIRED', 403, 'Only club members can place online orders.');
      }
      const { items, fulfilment, deliveryAddress, payNow } = request.body;
      const order = await shop.placeOrder({
        channel: 'ONLINE',
        customer,
        items,
        fulfilment,
        deliveryAddress,
        payment: payNow ? { method: payNow.method } : undefined,
        actorUserId: request.user!.id,
      });
      request.log.info({ orderId: order.id, orderNumber: order.orderNumber, channel: 'ONLINE' }, 'Order placed');
      return reply.status(201).send(order);
    }
  );

  fastify.get(
    '/orders',
    {
      preHandler: [requirePermission('orders:read')],
      schema: {
        description: 'All orders (front desk, owner)',
        tags: ['Shop'],
        querystring: OrderListQuerySchema,
        response: { 200: OrderPageSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => reply.send(await shop.listOrders(request.query))
  );

  fastify.get(
    '/me/orders',
    {
      preHandler: [ownSelf('orders:read:self')],
      schema: {
        description: "The caller's own orders",
        tags: ['Shop'],
        querystring: MyOrdersQuerySchema,
        response: { 200: OrderPageSchema, 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema },
      },
    },
    async (request, reply) =>
      reply.send(await shop.listMyOrders(request.user!.id, request.query.page, request.query.limit))
  );

  fastify.get(
    '/orders/:id',
    {
      preHandler: [requireStaffOrSelf('orders:read', 'orders:read:self')],
      schema: {
        description: 'One order. Members can only read their own.',
        tags: ['Shop'],
        params: IdParamSchema,
        response: { 200: OrderSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const access = await shop.getOrderAccess(request.params.id);
      if (!access) throw new DomainError('NOT_FOUND', 404, 'Order not found');
      if (!(await can(request, 'orders:read'))) {
        if (!(await can(request, 'orders:read:self', access.ownerUserId))) {
          return forbidden(request, reply, 'orders:read:self');
        }
      }
      return reply.send(await shop.getOrder(request.params.id));
    }
  );

  fastify.patch(
    '/orders/:id/status',
    {
      preHandler: [requirePermission('orders:update')],
      schema: {
        description: 'Advance an online order: PLACED to READY to COLLECTED (pickup), PLACED to OUT_FOR_DELIVERY to DELIVERED',
        tags: ['Shop'],
        params: IdParamSchema,
        body: UpdateOrderStatusRequestSchema,
        response: { 200: OrderSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.send(await shop.updateStatus(request.params.id, request.body.status))
  );

  fastify.post(
    '/orders/:id/pay',
    {
      preHandler: [requireStaffOrSelf('orders:update', 'orders:create:self')],
      schema: {
        description: 'Pay an unpaid order. Staff pick any method; a member can pay their own order by UPI.',
        tags: ['Shop'],
        params: IdParamSchema,
        body: PayOrderRequestSchema,
        response: { 200: PayOrderResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const access = await shop.getOrderAccess(request.params.id);
      if (!access) throw new DomainError('NOT_FOUND', 404, 'Order not found');
      const staff = await can(request, 'orders:update');
      if (!staff) {
        const own = await can(request, 'orders:create:self', access.ownerUserId);
        if (!own || request.body.method !== 'UPI') return forbidden(request, reply, 'orders:pay:self');
      }
      const result = await shop.payOrder(request.params.id, {
        method: request.body.method,
        reference: request.body.reference,
        receivedBy: staff ? request.user!.id : null,
      });
      request.log.info({ orderId: result.order.id, method: request.body.method }, 'Order paid');
      return reply.send(result);
    }
  );
};
