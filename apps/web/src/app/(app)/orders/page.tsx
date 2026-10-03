'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Order } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { qs, type Page } from '@/lib/ops';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { NoAccess, Pager, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const statusVariant: Record<string, BadgeProps['variant']> = {
  PLACED: 'warning', READY: 'success', OUT_FOR_DELIVERY: 'warning', COMPLETED: 'secondary', COLLECTED: 'secondary', DELIVERED: 'secondary', CANCELLED: 'outline',
};
const statuses = ['', 'PLACED', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'COLLECTED', 'DELIVERED', 'CANCELLED'];

/** The next steps a staff member can take on an online order. */
function nextSteps(order: Order): Array<'READY' | 'COLLECTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED'> {
  if (order.channel !== 'ONLINE') return [];
  if (order.status === 'PLACED') return order.fulfilment === 'DELIVERY' ? ['OUT_FOR_DELIVERY'] : ['READY'];
  if (order.status === 'READY') return ['COLLECTED'];
  if (order.status === 'OUT_FOR_DELIVERY') return ['DELIVERED'];
  return [];
}

export default function OrdersPage() {
  const { user, hasPermission } = useAuth();
  const staff = hasPermission('orders:read');
  const own = hasPermission('orders:read:self');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useOpsQuery<Page<Order>>(['orders', staff, status, page], staff ? `/orders${qs({ status, page, limit: 20 })}` : `/me/orders${qs({ page, limit: 20 })}`, { enabled: staff || own, refetchMs: 15000 });
  const advance = useOpsMutation<unknown, { id: string; status: string }>('patch', ['orders'], (v) => `/orders/${v.id}/status`);
  const cancel = useOpsMutation<unknown, { id: string }>('post', ['orders', 'products'], (v) => `/orders/${v.id}/cancel`);
  if (!user) return null;
  if (!staff && !own) return <NoAccess what="orders" />;

  async function run(action: () => Promise<unknown>, done: string) {
    try { await action(); toast.success(done); } catch (error) { toast.error(error instanceof Error ? error.message : 'That did not work. Please try again.'); }
  }
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={staff ? 'Orders' : 'My orders'} description={staff ? 'Counter and online shop orders. Online orders move from placed to ready or out for delivery.' : 'Your shop orders and their status.'} />
      {staff && <SelectBox id="order-status" label="Status" className="max-w-xs" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={statuses.map((s) => ({ value: s, label: s ? humanize(s) : 'All statuses' }))} />}
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No orders yet', description: 'Orders appear here as they are placed.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>When</TableHead><TableHead>Customer</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium tabular">{order.orderNumber}<div className="text-xs font-normal text-muted-foreground">{humanize(order.channel)} · {humanize(order.fulfilment)}</div></TableCell>
                <TableCell className="tabular">{formatDateTime(order.createdAt)}</TableCell>
                <TableCell>{order.member?.fullName ?? order.customerName ?? 'Walk-in'}{order.deliveryAddress && <div className="max-w-48 truncate text-xs text-muted-foreground">{order.deliveryAddress}</div>}</TableCell>
                <TableCell className="max-w-56 text-sm">{order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}</TableCell>
                <TableCell className="text-right"><Money paise={order.totalPaise} /><div className="text-xs text-muted-foreground">{humanize(order.paymentStatus)}</div></TableCell>
                <TableCell><Badge variant={statusVariant[order.status] ?? 'outline'}>{humanize(order.status)}</Badge></TableCell>
                <TableCell className="space-x-2 text-right">
                  {staff && nextSteps(order).map((next) => <Button key={next} size="sm" variant="outline" onClick={() => { void run(() => advance.mutateAsync({ id: order.id, status: next }), `Order ${order.orderNumber} ${humanize(next).toLowerCase()}`); }}>Mark {humanize(next).toLowerCase()}</Button>)}
                  {['PLACED'].includes(order.status) && <Button size="sm" variant="ghost" onClick={() => { void run(() => cancel.mutateAsync({ id: order.id }), `Order ${order.orderNumber} cancelled`); }}>Cancel</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager meta={query.data?.meta} onPage={setPage} />
      </QueryState>
    </div>
  );
}
