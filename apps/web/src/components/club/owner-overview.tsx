'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { OwnerOverview } from '@packages/validation';
import { ops } from '@/lib/ops';
import { formatMoney } from '@/lib/format';
import { clubTimeLabel } from '@/lib/table-bookings';
import { humanize } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

function Card({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link href={href} className="text-xs text-muted-foreground underline-offset-4 hover:underline">{linkLabel}</Link>
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

export function OverviewCards({ data }: { data: OwnerOverview }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Up next on court" href="/bookings" linkLabel="All bookings">
        {data.upcomingBookings.length === 0 ? <Empty>No upcoming bookings.</Empty> : (
          <ul className="divide-y">
            {data.upcomingBookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{b.who}</span><span className="block truncate text-xs text-muted-foreground">{b.court} · {b.sport}</span></span>
                <span className="tabular shrink-0 text-xs">{clubTimeLabel(Date.parse(b.startsAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="On shift now" href="/shifts" linkLabel="Shifts">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{data.staffOnShiftCount} clocked in</Badge>
          <Badge variant={data.pendingOrders > 0 ? 'warning' : 'outline'}>{data.pendingOrders} open {data.pendingOrders === 1 ? 'order' : 'orders'}</Badge>
          <Badge variant="outline">{data.openTabs} open bar {data.openTabs === 1 ? 'tab' : 'tabs'}</Badge>
        </div>
        {data.staffOnShift.length === 0 ? <Empty>Nobody has clocked in.</Empty> : (
          <ul className="divide-y">
            {data.staffOnShift.map((s) => (
              <li key={`${s.name}-${s.since}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate font-medium">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{humanize(s.role)} · since {clubTimeLabel(Date.parse(s.since))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Latest payments" href="/reports" linkLabel="Reports">
        {data.recentPayments.length === 0 ? <Empty>No payments recorded yet.</Empty> : (
          <ul className="divide-y">
            {data.recentPayments.map((p, i) => (
              <li key={`${p.paidAt}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{humanize(p.source)}{p.kind === 'REFUND' ? ' refund' : ''}</span><span className="block truncate text-xs text-muted-foreground">{p.who ?? 'Walk-in'} · {p.method} · {clubTimeLabel(Date.parse(p.paidAt))}</span></span>
                <span className={p.amountPaise < 0 ? 'tabular shrink-0 text-destructive' : 'tabular shrink-0'}>{formatMoney(p.amountPaise)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The "right now" row on the owner dashboard. Quiet on failure: the KPIs above stay useful without it. */
export function OwnerOverviewPanel() {
  const query = useQuery({ queryKey: ['reports', 'overview'], queryFn: () => ops.get<OwnerOverview>('/reports/overview'), refetchInterval: 15000 });
  if (query.isPending) return <div role="status" aria-label="Loading overview"><Skeleton className="h-48" /></div>;
  if (query.error || !query.data) return <p role="status" className="text-sm text-muted-foreground">Live activity is unavailable right now.</p>;
  return <OverviewCards data={query.data} />;
}
