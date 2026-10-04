'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { ReportRange } from '@packages/validation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { reportApi, type ReportPeriod } from '@/lib/report-api';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { ReportBreakdownPanel } from '@/components/club/report-breakdown';
import { formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatTile } from '@/components/club/stat-tile';
import { ReportCharts } from '@/components/club/charts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
export default function ReportsPage() {
  const { user, hasPermission } = useAuth(); const allowed = hasPermission('reports:read'); const canShare = allowed && hasPermission('reports:share');
  const [range, setRange] = useState<ReportRange | 'custom'>('today'); const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => dateAfter(calendarDate(), -29)); const [to, setTo] = useState(() => calendarDate());
  const customOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && Date.parse(to) - Date.parse(from) <= 365 * 86_400_000;
  const period: ReportPeriod = range === 'custom' ? { from, to } : range; const periodKey = range === 'custom' ? `${from}:${to}` : range; const ready = range !== 'custom' || customOk;
  const query = useQuery({ queryKey: ['reports', periodKey], queryFn: () => reportApi.dashboard(period), enabled: allowed && ready, refetchInterval: 10000 });
  const share = useMutation({ mutationFn: () => reportApi.share(period) });
  if (!user) return null;
  const report = query.data;
  return <div className="space-y-8"><PageHeader title="Club reports" description="Revenue, court use and what needs attention." actions={allowed ? <div className="flex gap-2"><a className={buttonVariants({ variant: 'outline' })} href={reportApi.exportUrl(period)}>Export CSV</a><a className={buttonVariants({ variant: 'outline' })} href={reportApi.exportUrl(period, 'breakdown')}>Export by area</a><a className={buttonVariants({ variant: 'outline' })} href={reportApi.pdfUrl(period)}>Download PDF</a>{canShare && <Button onClick={() => { share.reset(); setOpen(true); }}>Share</Button>}</div> : undefined} />{!allowed ? <EmptyState title="Reports are unavailable" description="Ask the owner for access." /> : <><Tabs value={range} onValueChange={value => setRange(value as ReportRange)}><TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="week">This week</TabsTrigger><TabsTrigger value="month">This month</TabsTrigger><TabsTrigger value="custom">Custom</TabsTrigger></TabsList></Tabs>{range === 'custom' && <div className="flex flex-wrap items-end gap-3"><div className="space-y-2"><label htmlFor="report-from" className="text-sm font-medium">From</label><Input id="report-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div><div className="space-y-2"><label htmlFor="report-to" className="text-sm font-medium">To</label><Input id="report-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>{!customOk && <p role="alert" className="text-sm text-destructive">Choose a start on or before the end, at most a year apart.</p>}</div>}{query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : query.isPending ? <div role="status" aria-label="Loading reports"><Skeleton className="h-64" /></div> : report ? <><div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"><StatTile label="Revenue" value={formatMoney(report.kpis.revenuePaise)} hint={<span className={report.kpis.changePct >= 0 ? 'text-success' : 'text-destructive'}>{report.kpis.changePct > 0 ? '+' : ''}{report.kpis.changePct}% vs previous</span>} /><StatTile label="Bookings" value={report.kpis.bookingsCount} /><StatTile label="Court utilisation" value={`${report.kpis.utilisationPct}%`} /><StatTile label="New members" value={report.kpis.newMembers} /></div>{report.kpis.revenuePaise === 0 ? <EmptyState title="No revenue this period" description="Recorded payments will appear here." /> : <ReportCharts report={report} />}<section className="space-y-4"><h2 className="text-lg font-semibold">What we owe</h2><dl className="divide-y">{[['Tax payable', report.owed.taxPayablePaise], ['Payroll due', report.owed.payrollDuePaise], ['Unpaid invoices', report.owed.unpaidInvoicesPaise]].map(([label, amount]) => <div className="flex justify-between py-3" key={label}><dt>{label}</dt><dd>{formatMoney(Number(amount))}</dd></div>)}</dl><p className="text-sm text-muted-foreground">{report.owed.overdueInvoicesCount} overdue invoices</p></section><section className="space-y-4"><h2 className="text-lg font-semibold">Needs attention</h2><ul className="space-y-2">{[{ href: '/inventory', count: report.alerts.lowStockCount, label: 'products low in stock' }, { href: '/members', count: report.alerts.expiringMembershipsCount, label: 'memberships expiring' }, { href: '/crm', count: report.alerts.newLeadsCount, label: 'new leads' }, { href: '/hr', count: report.alerts.pendingLeaveCount, label: 'leave requests pending' }].map(item => <li key={item.href}><Link className="underline underline-offset-4" href={item.href}>{item.count} {item.label}</Link></li>)}</ul></section><ReportBreakdownPanel period={period} enabled={ready} /></> : null}</>}
    <Dialog open={open && canShare} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Share club report</DialogTitle><DialogDescription>This link contains summary figures and expires in seven days.</DialogDescription></DialogHeader>{share.error && <PageError error={share.error} />}{share.data ? <><label htmlFor="share-url" className="text-sm">Share link</label><Input id="share-url" value={share.data.url} readOnly /><Button onClick={async () => { try { await navigator.clipboard.writeText(share.data!.url); toast.success('Link copied'); } catch { toast.error('Copy failed. Select the link and copy it manually.'); } }}>Copy link</Button></> : <Button disabled={share.isPending} onClick={() => share.mutate()}>{share.isPending ? 'Creating link…' : 'Create share link'}</Button>}</DialogContent></Dialog>
  </div>;
}

