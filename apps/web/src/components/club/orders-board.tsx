'use client';

import React from 'react';
import type { Order } from '@packages/validation';
import { formatDateTime } from '@/lib/format';
import { Money } from '@/components/club/money';
import { StatusBadge } from '@/components/club/status-badge';
import { humanize } from '@/components/club/ops-bits';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { KanbanBoard } from '@/components/club/views';

export type NextStatus = 'READY' | 'COLLECTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

const COLUMNS = [
  { id: 'COUNTER', title: 'Counter sales (POS)' },
  { id: 'PLACED', title: 'Placed (Online)' },
  { id: 'READY', title: 'Ready for pickup' },
  { id: 'OUT_FOR_DELIVERY', title: 'Out for delivery' },
  { id: 'DONE', title: 'Done / Completed' },
  { id: 'CANCELLED', title: 'Cancelled' },
];

const columnOf = (order: Order) => {
  if (order.channel === 'POS') return 'COUNTER';
  if (['COMPLETED', 'COLLECTED', 'DELIVERED'].includes(order.status)) return 'DONE';
  return order.status;
};

/** The next steps staff can take on an online order. */
export function nextSteps(order: Order): NextStatus[] {
  if (order.channel !== 'ONLINE') return [];
  if (order.status === 'PLACED') return order.fulfilment === 'DELIVERY' ? ['OUT_FOR_DELIVERY'] : ['READY'];
  if (order.status === 'READY') return ['COLLECTED'];
  if (order.status === 'OUT_FOR_DELIVERY') return ['DELIVERED'];
  return [];
}

/** The status an order moves to when dropped in a column, or null when that move is not allowed. */
export function statusForDrop(order: Order, column: string): NextStatus | null {
  const wanted = column === 'DONE' ? (order.status === 'OUT_FOR_DELIVERY' ? 'DELIVERED' : 'COLLECTED') : column;
  return nextSteps(order).find((step) => step === wanted) ?? null;
}

/** Orders as columns by fulfilment stage. Drag a card to the next column, or use its button. */
export function OrdersBoard({
  orders,
  canMove,
  onAdvance,
  onSelect,
}: {
  orders: Order[];
  canMove: boolean;
  onAdvance: (order: Order, next: NextStatus) => void;
  onSelect?: (order: Order) => void;
}) {
  return (
    <KanbanBoard
      columns={COLUMNS}
      items={orders}
      idOf={(o) => o.id}
      columnOf={columnOf}
      emptyLabel="No orders in this stage"
      onMove={
        canMove
          ? (order, to) => {
              const next = statusForDrop(order, to);
              if (next) onAdvance(order, next);
            }
          : undefined
      }
      canDrop={(order, to) => statusForDrop(order, to) !== null}
      renderCard={(order) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <p className="font-mono text-xs font-semibold tabular-nums">{order.orderNumber}</p>
              <Badge variant={order.channel === 'POS' ? 'default' : 'outline'} className="text-[10px] px-1.5 py-0">
                {order.channel === 'POS' ? 'POS' : order.fulfilment === 'DELIVERY' ? 'Delivery' : 'Pickup'}
              </Badge>
            </div>
            <StatusBadge kind="order" value={order.status} />
          </div>

          <p className="text-xs text-muted-foreground">
            {humanize(order.fulfilment)} &middot; {formatDateTime(order.createdAt)}
          </p>
          <p className="text-sm font-medium">
            {order.member?.fullName ?? order.customerName ?? 'Walk-in customer'}
          </p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {order.items.map((item) => `${item.qty}\u00D7 ${item.name}`).join(', ')}
          </p>
          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-sm font-semibold tabular-nums">
              <Money paise={order.totalPaise} />
            </span>
            {onSelect && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => onSelect(order)}
              >
                Receipt
              </Button>
            )}
          </div>
          {canMove &&
            nextSteps(order).map((next) => (
              <Button
                key={next}
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={() => onAdvance(order, next)}
              >
                Mark {humanize(next).toLowerCase()}
              </Button>
            ))}
        </div>
      )}
    />
  );
}
