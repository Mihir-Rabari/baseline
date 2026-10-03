'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useBarEarnings } from '@/hooks/use-bar';
import { clubToday } from '@/lib/mock-bar';
import { formatDateTime, formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatTile } from '@/components/club/stat-tile';
import { Money } from '@/components/club/money';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { DatePicker } from '@/components/ui/date-picker';

export default function EarningsPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(clubToday);
  const { query, canRead, canChooseDate } = useBarEarnings(date);
  if (!user) return null;
  const data = query.data;
  return <div className="space-y-6">
    <PageHeader title="Bar earnings" description="Review payments and hand over the closing report." actions={<>
      <Button asChild variant="outline"><Link href="/bar">Bar floor</Link></Button><Button variant="outline" disabled={!data} onClick={() => window.print()}>Print report</Button>
    </>} />
    {canRead && <div className="space-y-2"><Label htmlFor="earnings-date">Club date</Label><DatePicker id="earnings-date" className="w-56" value={date} max={clubToday()} disabled={!canChooseDate} shortcuts={false} onChange={(value) => { if (value) setDate(value); }} />{!canChooseDate && <p className="text-sm text-muted-foreground">Your earnings report shows today.</p>}</div>}
    {!canRead ? <EmptyState title="Bar access required" description="Ask the owner for access to bar earnings." /> : query.isPending ? <Skeleton className="h-72" /> : query.isError ? <PageError error={query.error} onRetry={() => query.refetch()} /> : data && <>
      <div className="grid gap-4 sm:grid-cols-3"><StatTile label="Takings" value={formatMoney(data.totalPaise)} /><StatTile label="Tabs settled" value={String(data.tabsSettled)} /><StatTile label="Average tab" value={formatMoney(data.averageTabPaise)} /></div>
      {data.tabsSettled === 0 ? <EmptyState title="No settled tabs" description="Payments appear here after a tab is settled on this date." /> : <>
        <section className="space-y-3"><h2 className="text-lg font-semibold">By payment mode</h2><dl className="divide-y rounded-lg border px-4">{data.byMethod.map((row) => <div key={row.method} className="flex justify-between py-3"><dt>{row.method === 'CASH' ? 'Cash' : row.method === 'CARD' ? 'Card' : 'UPI'}</dt><dd><Money paise={row.amountPaise} /></dd></div>)}</dl></section>
        <section className="space-y-3"><h2 className="text-lg font-semibold">By shift</h2>{!data.byShift.length ? <p className="text-sm text-muted-foreground">These payments are not linked to a staff shift.</p> : <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Shift</TableHead><TableHead className="text-right">Takings</TableHead></TableRow></TableHeader><TableBody>{data.byShift.map((row) => <TableRow key={row.shiftId}><TableCell>{row.employeeName}</TableCell><TableCell>{formatDateTime(row.startsAt)} – {formatDateTime(row.endsAt)}</TableCell><TableCell className="text-right"><Money paise={row.amountPaise} /></TableCell></TableRow>)}</TableBody></Table>}</section>
        <section className="space-y-3"><h2 className="text-lg font-semibold">Popular items</h2><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Quantity</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader><TableBody>{data.topItems.map((row) => <TableRow key={row.name}><TableCell>{row.name}</TableCell><TableCell className="tabular">{row.qty}</TableCell><TableCell className="text-right"><Money paise={row.amountPaise} /></TableCell></TableRow>)}</TableBody></Table></section>
      </>}
    </>}
  </div>;
}

