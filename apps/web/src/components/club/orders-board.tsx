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
  { id: 'PLACED', title: 'Placed' },
  { id: 'READY', title: 'Ready for pickup' },
  { id: 'OUT_FOR_DELIVERY', title: 'Out for delivery' },
  { id: 'DONE', title: 'Done' },
  { id: 'CANCELLED', title: 'Cancelled' },
];

const columnOf = (order: Order) =>
  ['COMPLETED', 'COLLECTED', 'DELIVERED'].includes(order.status) ? 'DONE' : order.status;

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
}: {
  orders: Order[];
  canMove: boolean;
  onAdvance: (order: Order, next: NextStatus) => void;
}) {
  return (
    <div className="w-full overflow-x-auto pb-4 pt-1">
      <KanbanBoard
        columns={COLUMNS}
        items={orders}
        idOf={(o) => o.id}
        columnOf={columnOf}
        emptyLabel="No orders"
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
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium tabular text-sm">{order.orderNumber}</p>
                <Badge
                  variant={order.channel === 'POS' ? 'secondary' : 'outline'}
                  className="mt-0.5 text-[10px] font-normal"
                >
                  {order.channel === 'POS'
                    ? 'POS Counter'
                    : order.fulfilment === 'DELIVERY'
                    ? 'Online Delivery'
                    : 'Online Pickup'}
                </Badge>
              </div>
              <StatusBadge kind="order" value={order.status} />
            </div>

            <p className="text-xs text-muted-foreground">
              {formatDateTime(order.createdAt)}
            </p>

            <p className="text-sm font-medium">
              {order.member?.fullName ?? order.customerName ?? 'Walk-in customer'}
            </p>

            {order.items.length > 0 && (
              <ul className="space-y-0.5 rounded bg-muted/40 p-2 text-xs">
                {order.items.map((item, idx) => (
                  <li key={idx} className="line-clamp-1">
                    <span className="font-semibold tabular">{item.qty}×</span> {item.name}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between pt-1 text-sm font-semibold">
              <span className="text-xs font-normal text-muted-foreground">Total</span>
              <Money paise={order.totalPaise} />
            </div>

            {canMove && nextSteps(order).length > 0 && (
              <div className="pt-1">
                {nextSteps(order).map((next) => (
                  <Button
                    key={next}
                    size="sm"
                    className="w-full text-xs font-medium"
                    variant="outline"
                    onClick={() => onAdvance(order, next)}
                  >
                    Mark {humanize(next).toLowerCase()}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      />
    </div>
  );
}
