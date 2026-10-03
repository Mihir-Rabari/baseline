'use client';

import React, { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SharedReportResponse } from '@packages/validation';
import { API_BASE_URL } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Money } from '@/components/club/money';
import { BarList, Stat, humanize } from '@/components/club/ops-bits';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Range = 'today' | 'week' | 'month';

export default function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [range, setRange] = useState<Range | ''>('');
  const report = useQuery({
    queryKey: ['shared-report', token, range],
    retry: false,
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/public/reports/shared/${encodeURIComponent(token)}${range ? `?range=${range}` : ''}`);
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as SharedReportResponse;
    },
  });
  const data = report.data;
  return (
    <section className="container space-y-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Club summary</h1>
        {data && <p className="text-sm text-muted-foreground">Shared view, read only. This link expires {formatDateTime(data.expiresAt)}.</p>}
      </div>
      {report.isPending ? <div role="status" aria-label="Loading summary"><Skeleton className="h-64 w-full" /></div>
        : report.error ? <EmptyState title="This link has expired or was revoked" description="Ask the club owner for a new link." />
        : data && (
          <div className="space-y-6">
            <Tabs value={range || (data.range as Range)} onValueChange={(value) => setRange(value as Range)}>
              <TabsList aria-label="Range"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="week">This week</TabsTrigger><TabsTrigger value="month">This month</TabsTrigger></TabsList>
            </Tabs>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Revenue" value={<Money paise={data.kpis.revenuePaise} />} hint={`${data.kpis.changePct >= 0 ? '+' : ''}${data.kpis.changePct}% vs previous period`} />
              <Stat label="Bookings" value={data.kpis.bookingsCount} hint={`${data.kpis.utilisationPct}% utilisation`} />
              <Stat label="New members" value={data.kpis.newMembers} />
              <Stat label="Shop orders · bar tabs" value={`${data.kpis.shopOrdersCount} · ${data.kpis.barTabsCount}`} />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">By source</h2><BarList rows={data.bySource.map((s) => ({ label: humanize(s.source), value: s.amountPaise }))} /></section>
              <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">By payment method</h2><BarList rows={data.byMethod.map((m) => ({ label: humanize(m.method), value: m.amountPaise }))} /></section>
            </div>
          </div>
        )}
    </section>
  );
}
