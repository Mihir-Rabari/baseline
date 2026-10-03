import { z } from 'zod';
import {
  ProductSchema, ProductPageSchema, PublicProductPageSchema, ProductListQuerySchema,
  PublicProductListQuerySchema, RestockRequestSchema, StockChangeResponseSchema,
  QuoteOrderRequestSchema, QuoteOrderResponseSchema, PosOrderRequestSchema,
  OnlineOrderRequestSchema, OrderSchema, OrderPageSchema, OrderListQuerySchema,
  UpdateOrderStatusRequestSchema, MemberLookupResponseSchema, CreateProductRequestSchema,
  UpdateProductRequestSchema, AdjustStockRequestSchema, StockMovementPageSchema,
  type ProductListQuery, type QuoteOrderRequest, type PosOrderRequest,
  type OnlineOrderRequest, type Order, type RestockRequest, type OrderListQuery,
  type UpdateOrderStatusRequest, type CreateProductRequest, type UpdateProductRequest,
  type AdjustStockRequest,
} from '@packages/validation';
import { fetchApi, USE_MOCKS, mock, ApiError } from '@/lib/api-client';
import fixture from '@/mocks/shop-products.json';
import { mockMemberStore } from '@/lib/mock-members';

const initialProducts = z.array(ProductSchema).parse(fixture);
const products = structuredClone(initialProducts);
const orders: Order[] = [];
export function resetShopMocks() { products.splice(0, products.length, ...structuredClone(initialProducts)); orders.splice(0); }
function queryString(params: Record<string, unknown>) { const query = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); }); return query.toString(); }
function page<T>(data: T[], current: number, limit: number) { return { data: structuredClone(data.slice((current - 1) * limit, current * limit)), meta: { page: current, limit, totalItems: data.length, totalPages: Math.ceil(data.length / limit), hasPrevPage: current > 1, hasNextPage: current < Math.ceil(data.length / limit) } }; }
function member(id?: string, own = false) { return mockMemberStore.find((entry) => entry.id === id) ?? (own ? mockMemberStore[0] : undefined); }
function discount(id?: string, own = false) { return member(id, own)?.entitlements.shopDiscountPct ?? 0; }
function product(id: string) { const value = products.find((entry) => entry.id === id); if (!value) throw new ApiError('Product not found', 404, 'NOT_FOUND'); return value; }
function normalize(items: QuoteOrderRequest['items']) { const grouped = new Map<string, number>(); items.forEach((line) => grouped.set(line.productId, (grouped.get(line.productId) ?? 0) + line.qty)); return [...grouped].map(([productId, qty]) => ({ productId, qty })); }
export function mockShopQuote(input: QuoteOrderRequest, own = false) {
  const data = QuoteOrderRequestSchema.parse(input); const pct = discount(data.memberId, own);
  const items = normalize(data.items).map((line) => { const p = product(line.productId); return { ...line, name: p.name, unitPricePaise: p.pricePaise, discountPct: pct, lineTotalPaise: Math.round(p.pricePaise * line.qty * (100 - pct) / 100), inStock: p.stockQty >= line.qty }; });
  const subtotalPaise = items.reduce((sum, line) => sum + line.unitPricePaise * line.qty, 0);
  const discounted = items.reduce((sum, line) => sum + line.lineTotalPaise, 0); const deliveryFeePaise = data.fulfilment === 'DELIVERY' ? 5000 : 0;
  return QuoteOrderResponseSchema.parse({ items, subtotalPaise, discountPaise: subtotalPaise - discounted, deliveryFeePaise, totalPaise: discounted + deliveryFeePaise, discountPct: pct });
}
export function mockShopOrder(input: PosOrderRequest | OnlineOrderRequest, pos: boolean) {
  const data = pos ? PosOrderRequestSchema.parse(input) : OnlineOrderRequestSchema.parse(input);
  const customerId = 'memberId' in data ? data.memberId : undefined; const own = !pos;
  const quote = mockShopQuote({ items: data.items, memberId: customerId, fulfilment: 'fulfilment' in data ? data.fulfilment : undefined }, own);
  const unavailable = quote.items.find((line) => !line.inStock);
  if (unavailable) throw new ApiError(`${unavailable.name} has insufficient stock. Reduce the quantity.`, 409, 'OUT_OF_STOCK', { productId: unavailable.productId });
  quote.items.forEach((line) => { const p = product(line.productId); p.stockQty -= line.qty; p.inStock = p.stockQty > 0; p.lowStock = p.stockQty <= (p.reorderLevel ?? 0); });
  const customer = member(customerId, own);
  const result = OrderSchema.parse({ id: crypto.randomUUID(), orderNumber: `ORD-${String(orders.length + 1).padStart(6, '0')}`, channel: pos ? 'POS' : 'ONLINE', fulfilment: 'fulfilment' in data ? data.fulfilment : 'COUNTER', status: pos ? 'COMPLETED' : 'PLACED', member: customer ? { id: customer.id, memberCode: customer.memberCode, fullName: customer.fullName } : null, customerName: 'customerName' in data ? data.customerName ?? null : null, deliveryAddress: 'deliveryAddress' in data ? data.deliveryAddress ?? null : null, items: quote.items, subtotalPaise: quote.subtotalPaise, discountPaise: quote.discountPaise, deliveryFeePaise: quote.deliveryFeePaise, totalPaise: quote.totalPaise, paymentStatus: pos || ('payNow' in data && data.payNow) ? 'PAID' : 'UNPAID', createdAt: new Date().toISOString() });
  orders.unshift(result); return structuredClone(result);
}
export const shopApi = {
  async products(params: Partial<ProductListQuery> = {}, access: 'public' | 'member' | 'staff' = 'staff') {
    const query = access === 'public' ? PublicProductListQuerySchema.parse(params) : ProductListQuerySchema.parse(params);
    if (!USE_MOCKS) { const result = await fetchApi<unknown>(`/api/v1/${access === 'public' ? 'public/' : ''}products?${queryString(query)}`); return access === 'public' ? PublicProductPageSchema.parse(result) : ProductPageSchema.parse(result); }
    const filtered = products.filter((p) => p.isActive && (!query.q || `${p.name} ${p.sku}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.category || p.category === query.category) && (!('lowStock' in query) || query.lowStock !== 'true' || p.lowStock));
    const result = page(filtered, query.page, query.limit);
    if (access === 'public') return mock(PublicProductPageSchema.parse(result));
    const pct = access === 'member' ? discount(undefined, true) : 0;
    return mock(ProductPageSchema.parse({ ...result, data: result.data.map((p) => ({ ...p, discountPct: pct, yourPricePaise: Math.round(p.pricePaise * (100 - pct) / 100) })) }));
  },
  async restock(id: string, input: RestockRequest) { const data = RestockRequestSchema.parse(input); if (!USE_MOCKS) return StockChangeResponseSchema.parse(await fetchApi(`/api/v1/products/${id}/restock`, { method: 'POST', body: JSON.stringify(data) })); const p = product(id); p.stockQty += data.qty; p.inStock = true; p.lowStock = p.stockQty <= (p.reorderLevel ?? 0); return mock(StockChangeResponseSchema.parse({ product: p, movement: { id: crypto.randomUUID(), qtyDelta: data.qty, balanceAfter: p.stockQty, reason: 'RESTOCK' } })); },
  async quote(input: QuoteOrderRequest, own = false) { const data = QuoteOrderRequestSchema.parse(input); return USE_MOCKS ? mock(mockShopQuote(data, own)) : QuoteOrderResponseSchema.parse(await fetchApi('/api/v1/orders/quote', { method: 'POST', body: JSON.stringify(data) })); },
  async pos(input: PosOrderRequest) { const data = PosOrderRequestSchema.parse(input); return USE_MOCKS ? mock(mockShopOrder(data, true)) : OrderSchema.parse(await fetchApi('/api/v1/orders/pos', { method: 'POST', body: JSON.stringify(data) })); },
  async online(input: OnlineOrderRequest) { const data = OnlineOrderRequestSchema.parse(input); return USE_MOCKS ? mock(mockShopOrder(data, false)) : OrderSchema.parse(await fetchApi('/api/v1/orders/online', { method: 'POST', body: JSON.stringify(data) })); },
  async lookup(q: string) { if (q.trim().length < 2) return []; if (!USE_MOCKS) return MemberLookupResponseSchema.parse(await fetchApi(`/api/v1/members/lookup?q=${encodeURIComponent(q)}`)); return mock(MemberLookupResponseSchema.parse(mockMemberStore.filter((m) => `${m.fullName} ${m.phone} ${m.memberCode}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map((m) => ({ id: m.id, memberCode: m.memberCode, fullName: m.fullName, phone: m.phone, planCode: m.membership?.plan.code ?? null, expiryState: m.membership?.expiryState ?? 'NONE', shopDiscountPct: m.entitlements.shopDiscountPct, barDiscountPct: m.entitlements.barDiscountPct })))); },
  async orders(params: Partial<OrderListQuery> = {}, own = false) { const query = OrderListQuerySchema.parse(params); if (!USE_MOCKS) return OrderPageSchema.parse(await fetchApi(`/api/v1/${own ? 'me/' : ''}orders?${queryString(query)}`)); return mock(OrderPageSchema.parse(page(orders.filter((order) => (!own || order.member?.id === member(undefined, true)?.id) && (!query.status || order.status === query.status) && (!query.channel || order.channel === query.channel)), query.page, query.limit))); },
  async status(id: string, input: UpdateOrderStatusRequest) { const data = UpdateOrderStatusRequestSchema.parse(input); if (!USE_MOCKS) return OrderSchema.parse(await fetchApi(`/api/v1/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify(data) })); const order = orders.find((entry) => entry.id === id); if (!order) throw new ApiError('Order not found', 404, 'NOT_FOUND'); const next = order.status === 'PLACED' ? (order.fulfilment === 'DELIVERY' ? 'OUT_FOR_DELIVERY' : 'READY') : order.status === 'READY' ? 'COLLECTED' : order.status === 'OUT_FOR_DELIVERY' ? 'DELIVERED' : null; if (next !== data.status) throw new ApiError('Order cannot move to this status', 409, 'INVALID_ORDER_STATUS'); order.status = data.status; return mock(OrderSchema.parse(order)); },
  async createProduct(input: CreateProductRequest) {
    const data = CreateProductRequestSchema.parse(input);
    if (!USE_MOCKS) return ProductSchema.parse(await fetchApi('/api/v1/products', { method: 'POST', body: JSON.stringify(data) }));
    const p = ProductSchema.parse({
      id: crypto.randomUUID(),
      sku: data.sku,
      name: data.name,
      category: data.category,
      imageUrl: data.imageUrl ?? null,
      pricePaise: data.pricePaise,
      yourPricePaise: data.pricePaise,
      discountPct: 0,
      stockQty: data.stockQty,
      inStock: data.stockQty > 0,
      lowStock: data.stockQty <= (data.reorderLevel ?? 5),
      reorderLevel: data.reorderLevel ?? 5,
      isActive: true,
    });
    products.unshift(p);
    return mock(p);
  },
  async updateProduct(id: string, input: UpdateProductRequest) {
    const data = UpdateProductRequestSchema.parse(input);
    if (!USE_MOCKS) return ProductSchema.parse(await fetchApi(`/api/v1/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }));
    const p = product(id);
    Object.assign(p, data);
    return mock(ProductSchema.parse(p));
  },
  async adjust(id: string, input: AdjustStockRequest) {
    const data = AdjustStockRequestSchema.parse(input);
    if (!USE_MOCKS) return StockChangeResponseSchema.parse(await fetchApi(`/api/v1/products/${id}/adjust`, { method: 'POST', body: JSON.stringify(data) }));
    const p = product(id);
    const balance = p.stockQty + data.qtyDelta;
    if (balance < 0) throw new ApiError('Adjustment would result in negative stock.', 409, 'STOCK_NEGATIVE');
    p.stockQty = balance;
    p.inStock = p.stockQty > 0;
    p.lowStock = p.stockQty <= (p.reorderLevel ?? 0);
    return mock(StockChangeResponseSchema.parse({
      product: p,
      movement: { id: crypto.randomUUID(), qtyDelta: data.qtyDelta, balanceAfter: balance, reason: 'ADJUSTMENT', note: data.note },
    }));
  },
  async deleteProduct(id: string) {
    if (!USE_MOCKS) return fetchApi<{ success: boolean; message: string; deactivated?: boolean }>(`/api/v1/products/${id}`, { method: 'DELETE' });
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) throw new ApiError('Product not found', 404, 'NOT_FOUND');
    products.splice(idx, 1);
    return mock({ success: true, message: 'Product deleted' });
  },
  async movements(id: string, pageNum = 1, limit = 20) {
    if (!USE_MOCKS) return StockMovementPageSchema.parse(await fetchApi(`/api/v1/products/${id}/movements?page=${pageNum}&limit=${limit}`));
    return mock(StockMovementPageSchema.parse({
      data: [
        { id: crypto.randomUUID(), qtyDelta: 10, balanceAfter: 10, reason: 'RESTOCK', note: 'Opening stock', createdAt: new Date().toISOString() },
      ],
      meta: { page: pageNum, limit, totalItems: 1, totalPages: 1, hasPrevPage: false, hasNextPage: false },
    }));
  },
};
