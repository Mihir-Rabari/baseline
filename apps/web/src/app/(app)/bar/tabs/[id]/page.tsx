'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { PaymentMethod } from '@packages/validation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useBarTab } from '@/hooks/use-bar';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Money } from '@/components/club/money';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/format';

export default function BarTabPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const state = useBarTab(id);
  const [settleOpen, setSettleOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [actionError, setActionError] = useState<string | null>(null);
  if (!user) return null;
  const tab = state.tab.data;
  const editable = tab?.status === 'OPEN' && state.canManage;
  const run = async (action: () => Promise<unknown>, success?: string) => {
    if (state.pending) return;
    setActionError(null);
    try { await action(); if (success) toast.success(success); }
    catch (error) { const message = error instanceof Error ? error.message : 'The tab could not be updated. Try again.'; setActionError(message); toast.error(message); }
  };
  return <div className="space-y-6">
    <PageHeader title={tab ? `Tab #${tab.tabNumber}` : 'Bar tab'} description={tab ? `${tab.table?.name ?? 'Walk-in'} · ${tab.member?.fullName ?? tab.guestName ?? 'Guest'}` : 'Add items, send them and settle the bill.'} actions={<Button asChild variant="outline"><Link href="/bar">Back to floor</Link></Button>} />
    {!state.canRead ? <EmptyState title="Bar access required" description="Ask the owner for access to this tab." /> :
      state.tab.isPending ? <Skeleton className="h-96" /> : state.tab.isError ? <PageError error={state.tab.error} onRetry={() => state.tab.refetch()} /> : tab && <>
        <div className="flex items-center gap-3"><Badge variant={tab.status === 'SETTLED' ? 'success' : tab.status === 'VOID' ? 'destructive' : 'outline'}>{tab.status === 'OPEN' ? 'Open' : tab.status === 'SETTLED' ? 'Settled' : 'Void'}</Badge><span className="text-sm text-muted-foreground">Opened {formatDateTime(tab.openedAt)}</span></div>
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        <div className="grid gap-6 lg:grid-cols-2">
          {tab.status === 'OPEN' && <section className="space-y-4" aria-label="Menu"><h2 className="text-lg font-semibold">Add items</h2>
            {state.menu.isPending ? <Skeleton className="h-64" /> : state.menu.isError ? <PageError error={state.menu.error} onRetry={() => state.menu.refetch()} /> :
              !state.menu.data?.some((item) => item.isAvailable) ? <EmptyState title="No menu items available" description="Ask the owner to update the menu." /> :
              <Tabs defaultValue="DRINK"><TabsList className="w-full"><TabsTrigger value="DRINK">Drinks</TabsTrigger><TabsTrigger value="FOOD">Food</TabsTrigger><TabsTrigger value="SNACK">Snacks</TabsTrigger></TabsList>
                {['DRINK', 'FOOD', 'SNACK'].map((category) => <TabsContent key={category} value={category}><div className="grid grid-cols-2 gap-3">
                  {state.menu.data?.filter((item) => item.category === category && item.isAvailable).map((item) => <button key={item.id} type="button" disabled={!editable || state.pending}
                    className="flex min-h-24 flex-col items-start justify-between gap-2 rounded-lg border bg-card p-4 text-left hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => run(() => state.add.mutateAsync({ menuItemId: item.id, qty: 1 }))}><span className="font-medium">{item.name}</span><Money paise={item.pricePaise} className="text-sm text-muted-foreground" /></button>)}
                </div></TabsContent>)}
              </Tabs>}
          </section>}
          <section className="space-y-4" aria-label="Bill"><h2 className="text-lg font-semibold">{tab.status === 'SETTLED' ? 'Receipt' : 'Items'}</h2>
            {!tab.items.some((item) => item.status !== 'VOID') ? <EmptyState title="No items yet" description="Select a menu item to start this bill." /> : <ul className="divide-y rounded-lg border px-4">
              {tab.items.filter((item) => item.status !== 'VOID').map((item) => <li key={item.id} className="space-y-2 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.name} <span className="tabular text-muted-foreground">× {item.qty}</span></p>{item.discountPct > 0 && <p className="text-sm text-muted-foreground">Member discount {item.discountPct}%</p>}{item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}</div><Money paise={item.lineTotalPaise} /></div>
                <div className="flex flex-wrap gap-2">{item.status === 'SENT' ? <Badge variant="outline">Sent</Badge> : <Badge variant="secondary">Pending</Badge>}
                  {editable && <Button size="sm" variant="outline" disabled={state.pending} onClick={() => run(() => state.add.mutateAsync({ menuItemId: item.menuItemId, qty: 1, ...(item.note ? { note: item.note } : {}) }))} aria-label={`Add one ${item.name}`}>Add one</Button>}
                  {editable && item.status === 'PENDING' && <Button size="sm" variant="ghost" disabled={state.pending} onClick={() => run(() => state.remove.mutateAsync(item.id))} aria-label={`Remove ${item.name} line`}>Remove line</Button>}
                </div></li>)}
            </ul>}
            <dl className="divide-y rounded-lg border px-4"><div className="flex justify-between py-3"><dt>Subtotal</dt><dd><Money paise={tab.subtotalPaise} /></dd></div><div className="flex justify-between py-3"><dt>Member discount</dt><dd><Money paise={tab.discountPaise} /></dd></div><div className="flex justify-between py-4 text-lg font-semibold"><dt>Total</dt><dd><Money paise={tab.totalPaise} /></dd></div></dl>
            {tab.status === 'OPEN' && <div className="flex flex-wrap gap-3">{state.canManage && <Button variant="outline" disabled={state.pending || !tab.items.some((item) => item.status === 'PENDING')} onClick={() => run(() => state.send.mutateAsync(), 'Items sent')}>Send to kitchen</Button>}
              {state.canSettle && <Button disabled={state.pending || tab.totalPaise <= 0} onClick={() => { setActionError(null); state.settle.reset(); setSettleOpen(true); }}>Settle tab</Button>}</div>}
            {tab.settledAt && <p className="text-sm text-muted-foreground">Paid {formatDateTime(tab.settledAt)}</p>}
          </section>
        </div>
      </>}
    <Dialog open={settleOpen && tab?.status === 'OPEN'} onOpenChange={(value) => { if (!state.pending) setSettleOpen(value); }}>
      <DialogContent><DialogHeader><DialogTitle>Settle tab #{tab?.tabNumber}</DialogTitle><DialogDescription>Confirm the payment you have received.</DialogDescription></DialogHeader>
        <p className="text-2xl font-semibold">{tab && <Money paise={tab.totalPaise} />}</p>
        <div className="grid grid-cols-3 gap-3">{(['CASH', 'CARD', 'UPI'] as const).map((value) => <Button key={value} variant={method === value ? 'secondary' : 'outline'} className="h-16" aria-pressed={method === value} onClick={() => setMethod(value)} disabled={state.pending}>{value === 'CASH' ? 'Cash' : value === 'CARD' ? 'Card' : 'UPI'}</Button>)}</div>
        {state.settle.isError && <p role="alert" className="text-sm text-destructive">{state.settle.error.message}</p>}
        <Button disabled={state.pending || !state.canSettle} onClick={() => run(async () => { await state.settle.mutateAsync({ payments: [{ method }] }); setSettleOpen(false); }, 'Tab settled')}>{state.pending ? 'Settling…' : 'Confirm payment'}</Button>
      </DialogContent>
    </Dialog>
  </div>;
}

