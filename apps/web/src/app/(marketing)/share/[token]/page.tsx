'use client';
import React from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '@/lib/report-api';
import { ReportCharts } from '@/components/club/charts';
import { StatTile } from '@/components/club/stat-tile';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, formatDateTime } from '@/lib/format';
export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const query = useQuery({ queryKey: ['shared-report', token], queryFn: () => reportApi.shared(token), retry: false });
  return <section className="container space-y-8 py-12"><div><h1 className="text-2xl font-semibold tracking-tight">Shared club report</h1><p className="text-muted-foreground">Read-only summary of club revenue and court use.</p></div>{query.isPending ? <Skeleton className="h-64" /> : query.error ? 'statusCode' in query.error && query.error.statusCode === 404 ? <EmptyState title="This link has expired or was revoked" description="Ask the owner for a new share link." /> : <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : query.data ? <><p className="text-sm text-muted-foreground">{query.data.from} to {query.data.to}{query.data.expiresAt ? ` · Expires ${formatDateTime(query.data.expiresAt)}` : ""}</p><div className="grid gap-6 sm:grid-cols-2"><StatTile label="Revenue" value={formatMoney(query.data.kpis.revenuePaise)} /><StatTile label="Bookings" value={query.data.kpis.bookingsCount} /></div><ReportCharts report={query.data} /></> : null}</section>;
}

