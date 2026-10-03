'use client';

import React from 'react';
import type { UpdateTicketStatusRequest } from '@packages/validation';
import { CardGrid, KanbanBoard, type KanbanColumn } from '@/components/club/views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface KitchenTicketItem {
  id: string;
  ticketNumber: number;
  status: 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  station: string;
  minutesWaiting: number;
  table?: { name: string } | null;
  tab: { tabNumber: number; label: string };
  items: Array<{ name: string; qty: number; note?: string | null }>;
}

export const KITCHEN_STAGE_CONFIG: Record<
  'NEW' | 'PREPARING' | 'READY',
  { action: string; next: UpdateTicketStatusRequest['status'] }
> = {
  NEW: { action: 'Start', next: 'PREPARING' },
  PREPARING: { action: 'Mark ready', next: 'READY' },
  READY: { action: 'Mark served', next: 'SERVED' },
};

const KITCHEN_COLUMNS: KanbanColumn[] = [
  { id: 'NEW', title: 'New' },
  { id: 'PREPARING', title: 'Preparing' },
  { id: 'READY', title: 'Ready' },
];

export function KitchenTicketCard({
  ticket,
  isPending,
  activePendingId,
  onMove,
}: {
  ticket: KitchenTicketItem;
  isPending: boolean;
  activePendingId?: string;
  onMove: (id: string, next: UpdateTicketStatusRequest['status']) => void;
}) {
  const stage = ticket.status as 'NEW' | 'PREPARING' | 'READY';
  const config = KITCHEN_STAGE_CONFIG[stage];

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">
            {ticket.table?.name ?? 'Walk-in'} · #{ticket.ticketNumber}
          </h3>
          <p className="text-xs text-muted-foreground">
            Tab #{ticket.tab.tabNumber} · {ticket.tab.label}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline">{ticket.station === 'BAR' ? 'Bar' : 'Kitchen'}</Badge>
        </div>
      </div>

      <p
        className={`tabular text-xs ${
          ticket.minutesWaiting >= 10 ? 'font-medium text-warning' : 'text-muted-foreground'
        }`}
      >
        Waiting {ticket.minutesWaiting} min
      </p>

      <ul className="space-y-1 border-t pt-2 text-xs">
        {ticket.items.map((item, index) => (
          <li key={index}>
            <p>
              <span className="tabular font-semibold">{item.qty} × </span>
              {item.name}
            </p>
            {item.note && <p className="text-muted-foreground">{item.note}</p>}
          </li>
        ))}
      </ul>

      {config && (
        <Button
          className="h-10 w-full text-xs"
          disabled={isPending}
          onClick={() => onMove(ticket.id, config.next)}
          aria-label={`${config.action} ticket ${ticket.ticketNumber}`}
        >
          {isPending && activePendingId === ticket.id ? 'Updating…' : config.action}
        </Button>
      )}
    </article>
  );
}

export function KitchenBoard({
  tickets,
  isPending,
  activePendingId,
  onMove,
}: {
  tickets: KitchenTicketItem[];
  isPending: boolean;
  activePendingId?: string;
  onMove: (id: string, next: UpdateTicketStatusRequest['status']) => void;
}) {
  const droppable = (ticket: KitchenTicketItem, to: string) => {
    if (ticket.status === 'NEW' && to === 'PREPARING') return true;
    if (ticket.status === 'PREPARING' && to === 'READY') return true;
    return false;
  };

  return (
    <KanbanBoard
      columns={KITCHEN_COLUMNS}
      items={tickets}
      idOf={(t) => t.id}
      columnOf={(t) => t.status}
      emptyLabel="Nothing here"
      canDrop={droppable}
      onMove={(ticket, to) => {
        if (droppable(ticket, to)) {
          onMove(ticket.id, to as UpdateTicketStatusRequest['status']);
        }
      }}
      renderCard={(ticket) => (
        <KitchenTicketCard
          ticket={ticket}
          isPending={isPending}
          activePendingId={activePendingId}
          onMove={onMove}
        />
      )}
    />
  );
}

export function KitchenCards({
  tickets,
  isPending,
  activePendingId,
  onMove,
}: {
  tickets: KitchenTicketItem[];
  isPending: boolean;
  activePendingId?: string;
  onMove: (id: string, next: UpdateTicketStatusRequest['status']) => void;
}) {
  return (
    <CardGrid>
      {tickets.map((ticket) => (
        <KitchenTicketCard
          key={ticket.id}
          ticket={ticket}
          isPending={isPending}
          activePendingId={activePendingId}
          onMove={onMove}
        />
      ))}
    </CardGrid>
  );
}
