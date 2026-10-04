import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineOrderRequestSchema, PublicProductPageSchema, OrderSchema } from '@packages/validation';
vi.mock('@/lib/api-client', async () => { const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client'); return { ...actual, USE_MOCKS: true, mock: async <T,>(data: T) => data }; });
import { mockShopQuote, mockShopOrder, resetShopMocks, shopApi } from '../../../../apps/web/src/lib/shop-api';
import products from '@/mocks/shop-products.json';
import { mockMemberStore } from '../../../../apps/web/src/lib/mock-members';

describe('shop state and contracts', () => {
  beforeEach(resetShopMocks);
  it('keeps public stock counts and staff fields private', async () => {
    const data = PublicProductPageSchema.parse(await shopApi.products({}, 'public'));
    expect(data.data).toHaveLength(12);
    expect(data.data[0]).not.toHaveProperty('stockQty'); expect(data.data[0]).not.toHaveProperty('reorderLevel');
  });
  it('filters low-stock inventory and restocks into the shared shelf', async () => {
    const before = await shopApi.products({ lowStock: 'true' }); expect(before.data).toHaveLength(4);
    const out = products[4];
    await shopApi.restock(out.id, { qty: 6, note: 'Delivery received' });
    const after = await shopApi.products({ q: out.name }); expect(after.data[0]).toMatchObject({ stockQty: 6, inStock: true, lowStock: false });
    await expect(shopApi.restock(out.id, { qty: 0 })).rejects.toThrow();
  });
  it('quotes member discounts and delivery fee without changing stock', () => {
    const m = mockMemberStore[0]; const quote = mockShopQuote({ memberId: m.id, fulfilment: 'DELIVERY', items: [{ productId: products[0].id, qty: 2 }] });
    expect(quote.discountPct).toBe(m.entitlements.shopDiscountPct);
    expect(quote.subtotalPaise).toBe(products[0].pricePaise * 2);
    expect(quote.totalPaise).toBe(quote.subtotalPaise - quote.discountPaise + 5000);
    expect(mockShopQuote({ items: [{ productId: products[0].id, qty: 10 }] }).items[0].inStock).toBe(true);
  });
  it('aggregates duplicate quantities, rejects insufficient stock atomically and preserves other products', () => {
    expect(() => mockShopOrder({ items: [{ productId: products[5].id, qty: 1 }, { productId: products[5].id, qty: 1 }, { productId: products[0].id, qty: 1 }], paymentMethod: 'CASH' }, true)).toThrow('insufficient stock');
    expect(mockShopQuote({ items: [{ productId: products[0].id, qty: 10 }, { productId: products[5].id, qty: 1 }] }).items.every((line) => line.inStock)).toBe(true);
  });
  it('creates typed paid POS orders and online orders drawing from the same stock', async () => {
    const pos = OrderSchema.parse(mockShopOrder({ items: [{ productId: products[5].id, qty: 1 }], paymentMethod: 'UPI' }, true));
    expect(pos).toMatchObject({ channel: 'POS', status: 'COMPLETED', paymentStatus: 'PAID', fulfilment: 'COUNTER' });
    expect(() => mockShopOrder({ items: [{ productId: products[5].id, qty: 1 }], fulfilment: 'PICKUP' }, false)).toThrow();
    const online = await shopApi.online({ items: [{ productId: products[0].id, qty: 1 }], fulfilment: 'DELIVERY', deliveryAddress: '12 Club Road' });
    expect(online).toMatchObject({ status: 'PLACED', fulfilment: 'DELIVERY', deliveryFeePaise: 5000, paymentStatus: 'UNPAID' });
    expect(OnlineOrderRequestSchema.safeParse({ items: [{ productId: products[0].id, qty: 1 }], fulfilment: 'DELIVERY' }).success).toBe(false);
  });
  it('advances orders only through the valid fulfilment transitions', async () => {
    const order = await shopApi.online({ items: [{ productId: products[0].id, qty: 1 }], fulfilment: 'PICKUP' });
    await expect(shopApi.status(order.id, { status: 'DELIVERED' })).rejects.toThrow();
    expect((await shopApi.status(order.id, { status: 'READY' })).status).toBe('READY');
    expect((await shopApi.status(order.id, { status: 'COLLECTED' })).status).toBe('COLLECTED');
    expect((await shopApi.orders({}, true)).data[0].status).toBe('COLLECTED');
  });
});
