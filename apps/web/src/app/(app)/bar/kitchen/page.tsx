'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { UpdateTicketStatusRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useKitchen } from '@/hooks/use-bar';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const columns: Array<{ status: 'NEW' | 'PREPARING' | 'READY'; label: string; action: string; next: UpdateTicketStatusRequest['status'] }> = [
  { status: 'NEW', label: 'New', action: 'Start', next: 'PREPARING' },
  { status: 'PREPARING', label: 'Preparing', action: 'Mark ready', next: 'READY' },
  { status: 'READY', label: 'Ready', action: 'Mark served', next: 'SERVED' },
];
export default function KitchenPage() {
  const { user, hasPermission } = useAuth();
  const { tickets, advance, canRead } = useKitchen();
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const move = async (id: string, status: UpdateTicketStatusRequest['status']) => {
    if (advance.isPending || !canRead) return;
    setError(null);
    try { await advance.mutateAsync({ id, status }); }
    catch (error) { setError(error instanceof Error ? error.message : 'The ticket could not be updated. Try again.'); }
  };
  return <div className="space-y-6">
    <PageHeader title="Kitchen" description="Start tickets, mark them ready and confirm service." actions={hasPermission('bar:read') && <Button asChild variant="outline"><Link href="/bar">Bar floor</Link></Button>} />
    {!canRead ? <EmptyState title="Kitchen access required" description="Ask the owner for access to kitchen tickets." /> :
      tickets.isPending ? <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div> :
      tickets.isError ? <PageError error={tickets.error} onRetry={() => tickets.refetch()} /> : <>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!tickets.data?.length ? <EmptyState title="No tickets" description="Sent bar items will appear here." /> : <div className="grid gap-4 md:grid-cols-3">{columns.map((column) => <section key={column.status} className="space-y-4" aria-label={column.label}>
          <h2 className="text-lg font-semibold">{column.label} <span className="tabular text-muted-foreground">{tickets.data?.filter((ticket) => ticket.status === column.status).length}</span></h2>
          {tickets.data?.filter((ticket) => ticket.status === column.status).length === 0 && <p className="text-sm text-muted-foreground">Nothing here</p>}
          {tickets.data?.filter((ticket) => ticket.status === column.status).map((ticket) => <article key={ticket.id} className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{ticket.table?.name ?? 'Walk-in'} · #{ticket.ticketNumber}</h3><p className="text-sm text-muted-foreground">Tab #{ticket.tab.tabNumber} · {ticket.tab.label}</p></div><Badge variant="outline">{ticket.station === 'BAR' ? 'Bar' : 'Kitchen'}</Badge></div>
            <p className={ticket.minutesWaiting >= 10 ? 'tabular text-sm text-warning' : 'tabular text-sm text-muted-foreground'}>Waiting {ticket.minutesWaiting} min</p>
            <ul className="space-y-2">{ticket.items.map((item, index) => <li key={index}><p><span className="tabular font-semibold">{item.qty} × </span>{item.name}</p>{item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}</li>)}</ul>
            <Button className="h-12 w-full" disabled={advance.isPending} onClick={() => move(ticket.id, column.next)} aria-label={`${column.action} ticket ${ticket.ticketNumber}`}>{advance.isPending && advance.variables?.id === ticket.id ? 'Updating…' : column.action}</Button>
          </article>)}
        </section>)}</div>}
      </>}
  </div>;
}

