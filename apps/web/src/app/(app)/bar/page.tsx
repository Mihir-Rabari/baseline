'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { BarTable, MenuItem, Tab, TabSummary } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { formatDateTime } from '@/lib/format';
import type { Page } from '@/lib/ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Money } from '@/components/club/money';
import { NoAccess, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const TAB_KEYS = ['bar'];

function NewTabDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const tables = useOpsQuery<BarTable[]>(['bar', 'tables'], '/bar/tables', { enabled: open });
  const [guest, setGuest] = useState('');
  const [tableId, setTableId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Tab, { guestName: string; tableId?: string }>('post', TAB_KEYS, () => '/bar/tabs');
  async function submit() {
    setError(null);
    if (!guest.trim()) return setError('Enter a name for the tab, for example "Table 4".');
    try {
      const tab = await create.mutateAsync({ guestName: guest.trim(), ...(tableId ? { tableId } : {}) });
      setGuest(''); setTableId(''); onCreated(tab.id); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open the tab.'); }
  }
  const free: BarTable[] = tables.data ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Open a tab</DialogTitle><DialogDescription>A tab collects everything a table orders until it is paid.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="tab-guest">Name</Label><Input id="tab-guest" value={guest} onChange={(event) => setGuest(event.target.value)} /></div>
        <SelectBox id="tab-table" label="Table (optional)" value={tableId} onChange={setTableId} options={[{ value: '', label: 'No table' }, ...free.filter((t) => t.status === 'FREE').map((t) => ({ value: t.id, label: t.name }))]} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending} onClick={() => { void submit(); }}>Open tab</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabPanel({ id, canSettle, onClosed }: { id: string; canSettle: boolean; onClosed: () => void }) {
  const tab = useOpsQuery<Tab>(['bar', 'tab', id], `/bar/tabs/${id}`, { refetchMs: 5000 });
  const menu = useOpsQuery<MenuItem[]>(['bar', 'menu'], '/bar/menu');
  const [category, setCategory] = useState('');
  const [settling, setSettling] = useState(false);
  const [method, setMethod] = useState('UPI');
  const [error, setError] = useState<string | null>(null);
  const add = useOpsMutation<Tab, { id: string; menuItemId: string; qty: number }>('post', TAB_KEYS, (v) => `/bar/tabs/${v.id}/items`);
  const setQty = useOpsMutation<Tab, { id: string; itemId: string; qty: number }>('patch', TAB_KEYS, (v) => `/bar/tabs/${v.id}/items/${v.itemId}`);
  const remove = useOpsMutation<Tab, { id: string; itemId: string }>('delete', TAB_KEYS, (v) => `/bar/tabs/${v.id}/items/${v.itemId}`);
  const send = useOpsMutation<unknown, { id: string }>('post', TAB_KEYS, (v) => `/bar/tabs/${v.id}/send`);
  const settle = useOpsMutation<unknown, { id: string; payments: Array<{ method: string }> }>('post', [...TAB_KEYS, 'reports', 'payments'], (v) => `/bar/tabs/${v.id}/settle`);
  const voidTab = useOpsMutation<unknown, { id: string; reason: string }>('post', TAB_KEYS, (v) => `/bar/tabs/${v.id}/void`);

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null);
    try { await action(); if (done) toast.success(done); } catch (caught) { setError(caught instanceof Error ? caught.message : 'That did not work.'); }
  }
  const data = tab.data;
  const items = (menu.data ?? []).filter((m) => m.isAvailable && (!category || m.category === category));
  const categories = [...new Set((menu.data ?? []).map((m) => m.category))];
  const lines = data?.items.filter((line) => line.status !== 'VOID') ?? [];
  const pending = lines.some((line) => line.status === 'PENDING');
  return (
    <QueryState query={tab}>
      {data && (
        <section className="space-y-4 rounded-lg border p-5" aria-label={`Tab ${data.tabNumber}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="text-lg font-semibold">Tab #{data.tabNumber} · {data.guestName ?? data.member?.fullName}</h2><p className="text-sm text-muted-foreground">{data.table?.name ?? 'No table'} · opened {formatDateTime(data.openedAt)}</p></div>
            <Badge variant={data.status === 'OPEN' ? 'warning' : 'secondary'}>{humanize(data.status)}</Badge>
          </div>
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">Nothing ordered yet. Tap an item below to add it.</p> : (
            <ul className="divide-y text-sm">
              {lines.map((line) => (
                <li key={line.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">{line.name}<span className="ml-2 text-xs text-muted-foreground">{line.status === 'SENT' ? 'with the kitchen' : 'not sent'}</span></span>
                  {data.status === 'OPEN' && line.status === 'PENDING' ? (
                    <span className="flex items-center gap-1">
                      <Button size="sm" variant="outline" aria-label={`One less ${line.name}`} disabled={line.qty <= 1 || setQty.isPending} onClick={() => { void run(() => setQty.mutateAsync({ id, itemId: line.id, qty: line.qty - 1 })); }}>−</Button>
                      <span className="w-6 text-center tabular">{line.qty}</span>
                      <Button size="sm" variant="outline" aria-label={`One more ${line.name}`} disabled={line.qty >= 20 || setQty.isPending} onClick={() => { void run(() => setQty.mutateAsync({ id, itemId: line.id, qty: line.qty + 1 })); }}>+</Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${line.name}`} onClick={() => { void run(() => remove.mutateAsync({ id, itemId: line.id })); }}>Remove</Button>
                    </span>
                  ) : <span className="w-8 text-center tabular">{line.qty}×</span>}
                  <span className="w-20 text-right tabular"><Money paise={line.lineTotalPaise} /></span>
                </li>
              ))}
            </ul>
          )}
          <dl className="space-y-1 border-t pt-3 text-sm">
            {data.discountPaise > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Member discount</dt><dd>−<Money paise={data.discountPaise} /></dd></div>}
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd><Money paise={data.totalPaise} /></dd></div>
          </dl>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {data.status === 'OPEN' && <>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!pending || send.isPending} onClick={() => { void run(() => send.mutateAsync({ id }), 'Sent to the kitchen'); }}>Send to kitchen</Button>
              {canSettle && <Button variant="outline" disabled={lines.length === 0} onClick={() => setSettling(true)}>Settle</Button>}
              <Button variant="ghost" onClick={() => { const reason = window.prompt('Why is this tab being voided?'); if (reason?.trim()) void run(async () => { await voidTab.mutateAsync({ id, reason: reason.trim() }); onClosed(); }, 'Tab voided'); }}>Void</Button>
            </div>
            <div className="space-y-2 border-t pt-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Menu category">
                <Button size="sm" variant={category === '' ? 'default' : 'outline'} onClick={() => setCategory('')}>All</Button>
                {categories.map((c) => <Button key={c} size="sm" variant={category === c ? 'default' : 'outline'} onClick={() => setCategory(c)}>{humanize(c)}</Button>)}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((item) => (
                  <button key={item.id} type="button" disabled={add.isPending} onClick={() => { void run(() => add.mutateAsync({ id, menuItemId: item.id, qty: 1 })); }} className="rounded-md border p-2 text-left text-sm hover:border-primary hover:bg-primary/5 disabled:opacity-60">
                    <span className="block font-medium">{item.name}</span><span className="text-xs text-muted-foreground tabular"><Money paise={item.pricePaise} /> · {humanize(item.station)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>}
          <Dialog open={settling} onOpenChange={setSettling}>
            <DialogContent>
              <DialogHeader><DialogTitle>Settle tab #{data.tabNumber}</DialogTitle><DialogDescription>Total <Money paise={data.totalPaise} />. Choose how the guest is paying.</DialogDescription></DialogHeader>
              <SelectBox id="settle-method" label="Payment method" value={method} onChange={setMethod} options={[{ value: 'UPI', label: 'UPI' }, { value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }]} />
              <DialogFooter><Button variant="outline" onClick={() => setSettling(false)}>Cancel</Button><Button disabled={settle.isPending} onClick={() => { void run(async () => { await settle.mutateAsync({ id, payments: [{ method }] }); setSettling(false); onClosed(); }, 'Tab settled'); }}>{settle.isPending ? 'Settling…' : 'Take payment'}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}
    </QueryState>
  );
}

export default function BarPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('bar:read');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const tabs = useOpsQuery<Page<TabSummary>>(['bar', 'tabs'], '/bar/tabs?status=OPEN&limit=50', { enabled: allowed, refetchMs: 8000 });
  if (!user) return null;
  if (!allowed) return <NoAccess what="the bar" />;
  const rows: TabSummary[] = tabs.data?.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Bar floor" description="Open tabs. Add drinks and food, send them to the kitchen, then settle." actions={hasPermission('bar:manage') ? <Button onClick={() => setCreating(true)}>New tab</Button> : undefined} />
      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <QueryState query={{ ...tabs, isEmpty: rows.length === 0 }} empty={{ title: 'No open tabs', description: 'Open a tab when a table sits down.' }}>
          <ul className="space-y-2" aria-label="Open tabs">
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => setSelected(row.id)} aria-pressed={selected === row.id} className={cn('w-full rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary', selected === row.id && 'border-primary bg-primary/5')}>
                  <span className="flex justify-between font-medium"><span>#{row.tabNumber} · {row.guestName ?? row.member?.fullName}</span><Money paise={row.totalPaise} /></span>
                  <span className="text-xs text-muted-foreground">{row.table?.name ?? 'No table'} · {row.itemCount} items</span>
                </button>
              </li>
            ))}
          </ul>
        </QueryState>
        {selected ? <TabPanel key={selected} id={selected} canSettle={hasPermission('bar:settle')} onClosed={() => setSelected(null)} /> : <EmptyState title="Choose a tab" description="Select a tab on the left, or open a new one." />}
      </div>
      <NewTabDialog open={creating} onClose={() => setCreating(false)} onCreated={setSelected} />
    </div>
  );
}
