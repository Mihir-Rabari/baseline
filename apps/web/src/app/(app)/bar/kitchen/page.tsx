'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Ticket } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { qs } from '@/lib/ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { NoAccess, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const variant: Record<string, BadgeProps['variant']> = { NEW: 'warning', PREPARING: 'secondary', READY: 'success' };
const next: Record<string, 'PREPARING' | 'READY' | 'SERVED' | undefined> = { NEW: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };
const label = { PREPARING: 'Start preparing', READY: 'Mark ready', SERVED: 'Mark served' };

export default function KitchenPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('bar:kitchen');
  const [station, setStation] = useState('');
  const tickets = useOpsQuery<Ticket[]>(['bar', 'tickets', station], `/bar/tickets${qs({ station })}`, { enabled: allowed, refetchMs: 5000 });
  const update = useOpsMutation<unknown, { id: string; status: string }>('patch', ['bar'], (v) => `/bar/tickets/${v.id}/status`);
  if (!user) return null;
  if (!allowed) return <NoAccess what="the kitchen screen" />;

  async function move(ticket: Ticket, status: string) {
    try { await update.mutateAsync({ id: ticket.id, status }); toast.success(`Ticket ${ticket.ticketNumber}: ${humanize(status).toLowerCase()}`); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Could not update the ticket.'); }
  }
  const rows = tickets.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Kitchen" description="Orders waiting to be made, oldest first. Updates every 5 seconds." />
      <SelectBox id="station" label="Station" className="max-w-xs" value={station} onChange={setStation} options={[{ value: '', label: 'All stations' }, { value: 'BAR', label: 'Bar' }, { value: 'KITCHEN', label: 'Kitchen' }]} />
      <QueryState query={{ ...tickets, isEmpty: rows.length === 0 }} empty={{ title: 'Nothing to make', description: 'New tickets appear as soon as a tab is sent to the kitchen.' }}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((ticket) => (
            <article key={ticket.id} className="space-y-3 rounded-lg border p-4" aria-label={`Ticket ${ticket.ticketNumber}`}>
              <header className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold">#{ticket.ticketNumber} · {ticket.tab.label}</h2><p className="text-xs text-muted-foreground">{ticket.table?.name ?? 'No table'} · {humanize(ticket.station)} · waiting {ticket.minutesWaiting} min</p></div>
                <Badge variant={variant[ticket.status] ?? 'outline'}>{humanize(ticket.status)}</Badge>
              </header>
              <ul className="space-y-1 text-sm">
                {ticket.items.map((item, index) => <li key={index}><span className="tabular font-medium">{item.qty}×</span> {item.name}{item.note && <span className="text-muted-foreground"> — {item.note}</span>}</li>)}
              </ul>
              <div className="flex gap-2">
                {next[ticket.status] && <Button size="sm" disabled={update.isPending} onClick={() => { void move(ticket, next[ticket.status]!); }}>{label[next[ticket.status]!]}</Button>}
                {ticket.status === 'NEW' && <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => { void move(ticket, 'CANCELLED'); }}>Cancel</Button>}
              </div>
            </article>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
