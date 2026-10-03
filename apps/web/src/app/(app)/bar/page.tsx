'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BarTable, MemberLookupItem } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useBarTables } from '@/hooks/use-bar';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { MemberSearch } from '@/components/club/member-search';
import { Money } from '@/components/club/money';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { minutesSince } from '@/lib/mock-bar';

export default function BarFloorPage() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const { tables, open, canRead, canManage } = useBarTables();
  const [selected, setSelected] = useState<BarTable | null>(null);
  const [member, setMember] = useState<MemberLookupItem | null>(null);
  const [guestName, setGuestName] = useState('');
  if (!user) return null;
  const close = () => { setSelected(null); setMember(null); setGuestName(''); open.reset(); };
  const openTab = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || open.isPending || !canManage || (!member && !guestName.trim())) return;
    try {
      const tab = await open.mutateAsync({ tableId: selected.id, ...(member ? { memberId: member.id } : { guestName: guestName.trim() }) });
      close(); router.push(`/bar/tabs/${tab.id}`);
    } catch { /* The dialog keeps the entered details and displays the actionable API error. */ }
  };
  return <div className="space-y-6">
    <PageHeader title="Bar floor" description="Open a table or continue an existing tab." actions={<>
      {hasPermission('bar:kitchen') && <Button asChild variant="outline"><Link href="/bar/kitchen">Kitchen</Link></Button>}
      {canRead && <Button asChild variant="outline"><Link href="/bar/earnings">Earnings</Link></Button>}
    </>} />
    {!canRead ? <EmptyState title="Bar access required" description="Ask the owner for access to the bar floor." /> :
      tables.isPending ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div> :
      tables.isError ? <PageError error={tables.error} onRetry={() => tables.refetch()} /> :
      !tables.data?.length ? <EmptyState title="No tables configured" description="Ask the owner to add bar tables." /> :
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">{tables.data.map((table) => {
        const content = <><span className="text-lg font-semibold">{table.name}</span><Badge variant={table.openTab ? 'warning' : 'outline'}>{table.openTab ? 'Occupied' : 'Free'}</Badge>
          {table.openTab ? <><span className="text-sm">#{table.openTab.tabNumber} · {table.openTab.label}</span><Money paise={table.openTab.totalPaise} /><span className="text-xs text-muted-foreground">Open {minutesSince(table.openTab.openedAt)} min</span></> : <span className="text-sm text-muted-foreground">{table.seats} seats</span>}</>;
        const className = 'flex min-h-40 flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
        return table.openTab ? <Link key={table.id} className={className} href={`/bar/tabs/${table.openTab.id}`} aria-label={`Open ${table.name} tab`}>{content}</Link> :
          <button key={table.id} className={className} disabled={!canManage} onClick={() => { open.reset(); setSelected(table); }} aria-label={`Open tab for ${table.name}`}>{content}</button>;
      })}</div>}
    <Dialog open={Boolean(selected)} onOpenChange={(value) => { if (!value && !open.isPending) close(); }}>
      <DialogContent><DialogHeader><DialogTitle>Open tab · {selected?.name}</DialogTitle><DialogDescription>Choose a member for their discount, or enter a guest name.</DialogDescription></DialogHeader>
        <form onSubmit={openTab} className="space-y-4">
          {hasPermission('members:read') && <MemberSearch value={member} onChange={setMember} disabled={open.isPending} />}
          {member && <p className="text-sm text-muted-foreground">Bar discount {member.barDiscountPct}%</p>}
          {!member && <div className="space-y-2"><Label htmlFor="bar-guest">Guest name</Label><Input id="bar-guest" autoComplete="name" value={guestName} maxLength={200} onChange={(event) => setGuestName(event.target.value)} disabled={open.isPending} required /></div>}
          {open.isError && <p role="alert" className="text-sm text-destructive">{open.error.message}</p>}
          <Button className="w-full" type="submit" disabled={open.isPending || !canManage || (!member && !guestName.trim())}>{open.isPending ? 'Opening…' : 'Open tab'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

