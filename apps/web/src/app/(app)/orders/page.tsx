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
import { CardGrid, KanbanBoard, ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';
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

const VIEWS: ViewKind[] = ['list', 'cards', 'board'];
const COLUMNS = [
  { id: 'PLACED', title: 'Placed' }, { id: 'READY', title: 'Ready for pickup' }, { id: 'OUT_FOR_DELIVERY', title: 'Out for delivery' },
  { id: 'DONE', title: 'Done' }, { id: 'CANCELLED', title: 'Cancelled' },
];
const columnOfOrder = (order: Order) => (['COMPLETED', 'COLLECTED', 'DELIVERED'].includes(order.status) ? 'DONE' : order.status);
/** The status an order moves to when dropped in a board column, or null when that move is not allowed. */
function statusForDrop(order: Order, column: string): string | null {
  if (column === 'CANCELLED') return order.status === 'PLACED' ? 'CANCELLED' : null;
  const wanted = column === 'DONE' ? (order.status === 'OUT_FOR_DELIVERY' ? 'DELIVERED' : 'COLLECTED') : column;
  return (nextSteps(order) as string[]).includes(wanted) ? wanted : null;
}

function OrderCard({ order, staff, onAdvance, onCancel }: { order: Order; staff: boolean; onAdvance: (order: Order, status: string) => void; onCancel: (order: Order) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2"><p className="font-medium tabular">{order.orderNumber}</p><Badge variant={statusVariant[order.status] ?? 'outline'}>{humanize(order.status)}</Badge></div>
      <p className="text-xs text-muted-foreground">{humanize(order.channel)} · {humanize(order.fulfilment)} · {formatDateTime(order.createdAt)}</p>
      <p className="text-sm">{order.member?.fullName ?? order.customerName ?? 'Walk-in'}</p>
      {order.deliveryAddress && <p className="truncate text-xs text-muted-foreground">{order.deliveryAddress}</p>}
      <p className="line-clamp-2 text-xs">{order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}</p>
      <div className="flex items-center justify-between gap-2"><span className="tabular text-sm font-medium"><Money paise={order.totalPaise} /></span><span className="text-xs text-muted-foreground">{humanize(order.paymentStatus)}</span></div>
      <div className="flex flex-wrap gap-2 pt-1">
        {staff && nextSteps(order).map((next) => <Button key={next} size="sm" variant="outline" onClick={() => onAdvance(order, next)}>Mark {humanize(next).toLowerCase()}</Button>)}
        {order.status === 'PLACED' && <Button size="sm" variant="ghost" onClick={() => onCancel(order)}>Cancel</Button>}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { user, hasPermission } = useAuth();
  const staff = hasPermission('orders:read');
  const own = hasPermission('orders:read:self');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useViewPreference('orders', VIEWS, 'list');
  const board = view === 'board';
  const query = useOpsQuery<Page<Order>>(['orders', staff, board ? 'board' : status, board ? 1 : page, view], staff ? `/orders${board ? qs({ limit: 100 }) : qs({ status, page, limit: view === 'cards' ? 12 : 20 })}` : `/me/orders${qs({ page, limit: board ? 100 : 20 })}`, { enabled: staff || own, refetchMs: 15000 });
  const advance = useOpsMutation<unknown, { id: string; status: string }>('patch', ['orders'], (v) => `/orders/${v.id}/status`);
  const cancel = useOpsMutation<unknown, { id: string }>('post', ['orders', 'products'], (v) => `/orders/${v.id}/cancel`);
  if (!user) return null;
  if (!staff && !own) return <NoAccess what="orders" />;

  async function run(action: () => Promise<unknown>, done: string) {
    try { await action(); toast.success(done); } catch (error) { toast.error(error instanceof Error ? error.message : 'That did not work. Please try again.'); }
  }
  const rows = query.data?.data ?? [];
  const onAdvance = (order: Order, next: string) => { void run(() => advance.mutateAsync({ id: order.id, status: next }), `Order ${order.orderNumber} ${humanize(next).toLowerCase()}`); };
  const onCancel = (order: Order) => { void run(() => cancel.mutateAsync({ id: order.id }), `Order ${order.orderNumber} cancelled`); };
  const card = (order: Order) => <OrderCard order={order} staff={staff} onAdvance={onAdvance} onCancel={onCancel} />;
  return (
    <div className="space-y-6">
      <PageHeader actions={<ViewSwitcher views={VIEWS} value={view} onChange={setView} />} title={staff ? 'Orders' : 'My orders'} description={staff ? 'Counter and online shop orders. Online orders move from placed to ready or out for delivery.' : 'Your shop orders and their status.'} />
      {staff && !board && <SelectBox id="order-status" label="Status" className="max-w-xs" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={statuses.map((s) => ({ value: s, label: s ? humanize(s) : 'All statuses' }))} />}
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No orders yet', description: 'Orders appear here as they are placed.' }}>
        {board ? (
          <KanbanBoard columns={COLUMNS} items={rows} idOf={(o) => o.id} columnOf={columnOfOrder} renderCard={card} emptyLabel="No orders"
            onMove={staff ? (order, to) => { const next = statusForDrop(order, to); if (next === 'CANCELLED') onCancel(order); else if (next) onAdvance(order, next); } : undefined}
            canDrop={(order, to) => statusForDrop(order, to) !== null} />
        ) : view === 'cards' ? (
          <CardGrid>{rows.map((order) => <div key={order.id} className="rounded-lg border bg-card p-4">{card(order)}</div>)}</CardGrid>
        ) : (
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
        )}
        {!board && <Pager meta={query.data?.meta} onPage={setPage} />}
      </QueryState>
    </div>
  );
}
