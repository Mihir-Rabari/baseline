import type { Order } from '@packages/validation';

export type OrderChannelFilter = 'ALL' | 'ONLINE' | 'POS';

export function filterOrders(orders: Order[], queryText: string, channel: OrderChannelFilter): Order[] {
  const q = queryText.trim().toLowerCase();
  return orders.filter((order) => {
    // Channel filter
    if (channel !== 'ALL' && order.channel !== channel) {
      return false;
    }
    // Search query
    if (q) {
      const matchOrderNo = order.orderNumber.toLowerCase().includes(q);
      const matchCustomer = (order.member?.fullName ?? order.customerName ?? 'Walk-in').toLowerCase().includes(q);
      const matchItems = order.items.some((item) => item.name.toLowerCase().includes(q));
      if (!matchOrderNo && !matchCustomer && !matchItems) {
        return false;
      }
    }
    return true;
  });
}
