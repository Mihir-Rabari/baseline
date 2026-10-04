'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReportBreakdown } from '@packages/validation';
import { reportApi, type ReportPeriod } from '@/lib/report-api';
import { formatMoney } from '@/lib/format';
import { PageError } from '@/components/club/page-error';
import { humanize } from '@/components/club/ops-bits';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function Section({ title, summary, children }: { title: string; summary: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="space-y-3 break-inside-avoid rounded-lg border p-4" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
      {children}
    </section>
  );
}

function Rows({ head, rows, empty }: { head: string[]; rows: Array<Array<React.ReactNode>>; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader><TableRow>{head.map((h, i) => <TableHead key={h} className={i > 0 ? 'text-right' : undefined}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((cells, r) => <TableRow key={r}>{cells.map((c, i) => <TableCell key={i} className={i > 0 ? 'tabular text-right' : 'font-medium'}>{c}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
  );
}

export function BreakdownSections({ r }: { r: ReportBreakdown }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Court bookings" summary={`${r.bookings.total} booked, ${r.bookings.cancelled} cancelled, ${formatMoney(r.bookings.bookedValuePaise)}`}>
        <Rows head={['Sport', 'Bookings', 'Value']} empty="No bookings in this period." rows={r.bookings.bySport.map((s) => [s.sport, s.count, formatMoney(s.amountPaise)])} />
        <Rows head={['Court', 'Bookings']} empty="" rows={r.bookings.byCourt.map((c) => [c.court, c.count])} />
        <Rows head={['Booked through', 'Bookings']} empty="" rows={r.bookings.byChannel.map((c) => [humanize(c.channel), c.count])} />
      </Section>
      <Section title="Shop and counter sales" summary={`${r.orders.count} orders, ${formatMoney(r.orders.revenuePaise)}`}>
        <Rows head={['Channel', 'Orders', 'Revenue']} empty="No orders in this period." rows={r.orders.byChannel.map((c) => [humanize(c.channel), c.count, formatMoney(c.amountPaise)])} />
        <Rows head={['Top products', 'Sold', 'Revenue']} empty="" rows={r.orders.topProducts.map((p) => [p.name, p.qty, formatMoney(p.amountPaise)])} />
      </Section>
      <Section title="Bar" summary={`${r.bar.tabsSettled} tabs settled, ${formatMoney(r.bar.revenuePaise)}, average ${formatMoney(r.bar.averageTabPaise)}`}>
        <Rows head={['Top items', 'Sold', 'Revenue']} empty="No bar sales in this period." rows={r.bar.topItems.map((p) => [p.name, p.qty, formatMoney(p.amountPaise)])} />
      </Section>
      <Section title="Inventory" summary={`${r.inventory.unitsSold} units sold, stock worth ${formatMoney(r.inventory.stockValuePaise)}`}>
        <Rows head={['Low stock', 'In stock', 'Reorder at']} empty="Nothing is running low." rows={r.inventory.lowStock.map((p) => [`${p.name} (${p.sku})`, p.stockQty, p.reorderLevel])} />
      </Section>
      <Section title="Members" summary={`${r.members.newMembers} joined, ${r.members.activeMemberships} active, ${r.members.expiringSoon} expiring within 7 days`}>
        <Rows head={['Plan', 'Active']} empty="No active memberships." rows={r.members.byPlan.map((p) => [p.plan, p.active])} />
      </Section>
      <Section title="Payroll" summary={`${r.payroll.activeEmployees} staff, ${formatMoney(r.payroll.monthlyPayrollPaise)} a month, ${r.payroll.pendingLeave} leave requests pending`}>
        <Rows head={['Department', 'Staff', 'Monthly']} empty="No active staff." rows={r.payroll.byDepartment.map((d) => [humanize(d.department), d.employees, formatMoney(d.monthlyPaise)])} />
        <p className="mt-4 text-sm text-muted-foreground">{r.payroll.approvedLeaveDays} approved leave days in this period</p>
        <Rows head={['Payroll run', 'Payslips', 'Net paid']} empty="No payroll runs in this period." rows={r.payroll.runs.map((x) => [`${x.month} (${humanize(x.status)})`, x.payslips, formatMoney(x.netPaise)])} />
      </Section>
    </div>
  );
}

/** The per-area figures under the dashboard, for the same period. */
export function ReportBreakdownPanel({ period, enabled = true }: { period: ReportPeriod; enabled?: boolean }) {
  const key = typeof period === 'string' ? period : `${period.from}:${period.to}`;
  const query = useQuery({ queryKey: ['reports', 'breakdown', key], queryFn: () => reportApi.breakdown(period), enabled });
  return (
    <section className="space-y-4" aria-label="Breakdown by area">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">By area</h2>
        <nav aria-label="Area exports" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">Download rows (CSV):</span>
          {(['bookings', 'orders', 'bar', 'inventory', 'members', 'payroll'] as const).map((t) => <a key={t} className="underline underline-offset-4" href={reportApi.exportUrl(period, t)}>{humanize(t)}</a>)}
          <a className="underline underline-offset-4" href={reportApi.pdfUrl(period, 'breakdown')}>PDF</a>
        </nav>
      </div>
      {query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : query.isPending ? <div role="status" aria-label="Loading breakdown"><Skeleton className="h-48" /></div> : <BreakdownSections r={query.data} />}
    </section>
  );
}
