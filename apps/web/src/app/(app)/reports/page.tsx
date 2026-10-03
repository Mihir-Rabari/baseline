'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { CreateReportShareResponse, DashboardReport, ReportShare } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { API_BASE_URL } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { BarList, NoAccess, QueryState, SelectBox, Stat, humanize } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ranges = { today: 'Today', week: 'This week', month: 'This month' } as const;
type Range = keyof typeof ranges;

function ShareDialog({ open, onClose, range }: { open: boolean; onClose: () => void; range: Range }) {
  const shares = useOpsQuery<ReportShare[]>(['reports', 'shares'], '/reports/shares', { enabled: open });
  const create = useOpsMutation<CreateReportShareResponse, { defaultRange: Range; expiresInDays: number }>('post', ['reports'], () => '/reports/shares');
  const revoke = useOpsMutation<unknown, { id: string }>('delete', ['reports'], (v) => `/reports/shares/${v.id}`);
  const [days, setDays] = useState('7');
  const [created, setCreated] = useState<CreateReportShareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    try { setCreated(await create.mutateAsync({ defaultRange: range, expiresInDays: Number(days) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create the link.'); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setCreated(null); onClose(); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Share this dashboard</DialogTitle><DialogDescription>Anyone with the link sees a read-only summary: no customer names, and no tax or payroll figures.</DialogDescription></DialogHeader>
        {created ? (
          <div className="space-y-2">
            <p className="text-sm">Copy the link now. For safety it is shown only once.</p>
            <div className="flex gap-2"><Input readOnly aria-label="Share link" value={created.url} onFocus={(event) => event.currentTarget.select()} /><Button onClick={() => { void navigator.clipboard.writeText(created.url).then(() => toast.success('Link copied')); }}>Copy</Button></div>
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <SelectBox id="share-days" label="Link works for" className="w-40" value={days} onChange={setDays} options={['1', '7', '14', '30'].map((d) => ({ value: d, label: `${d} day${d === '1' ? '' : 's'}` }))} />
            <Button disabled={create.isPending} onClick={() => { void submit(); }}>{create.isPending ? 'Creating…' : 'Create link'}</Button>
          </div>
        )}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <section className="space-y-2 border-t pt-3"><h3 className="text-sm font-medium">Existing links</h3>
          <QueryState query={{ ...shares, isEmpty: (shares.data ?? []).length === 0 }} empty={{ title: 'No links yet' }}>
            <ul className="divide-y text-sm">{(shares.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <span>{humanize(s.defaultRange)} · expires {formatDateTime(s.expiresAt)}</span>
                {s.revokedAt ? <Badge variant="outline">Revoked</Badge> : <Button size="sm" variant="ghost" onClick={() => { void revoke.mutateAsync({ id: s.id }).then(() => toast.success('Link revoked')).catch((e: Error) => toast.error(e.message)); }}>Revoke</Button>}
              </li>
            ))}</ul>
          </QueryState>
        </section>
        <DialogFooter><Button variant="outline" onClick={() => { setCreated(null); onClose(); }}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('reports:read');
  const [range, setRange] = useState<Range>('month');
  const [sharing, setSharing] = useState(false);
  const report = useOpsQuery<DashboardReport>(['reports', 'dashboard', range], `/reports/dashboard?range=${range}`, { enabled: allowed, refetchMs: 10000 });
  if (!user) return null;
  if (!allowed) return <NoAccess what="reports" />;
  const data = report.data;
  const k = data?.kpis;
  const trend = (data?.trend ?? []).map((point) => ({ label: point.bucket, value: point.totalPaise }));
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Live revenue, bookings and what the club owes. Updates every 10 seconds."
        actions={<>
          <a className={buttonVariants({ variant: 'outline' })} href={`${API_BASE_URL}/api/v1/reports/export.csv?range=${range}`}>Export CSV</a>
          {hasPermission('reports:share') && <Button onClick={() => setSharing(true)}>Share</Button>}
        </>} />
      <Tabs value={range} onValueChange={(value) => setRange(value as Range)}><TabsList aria-label="Range">{(Object.keys(ranges) as Range[]).map((r) => <TabsTrigger key={r} value={r}>{ranges[r]}</TabsTrigger>)}</TabsList></Tabs>
      <QueryState query={report}>
        {data && k && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Revenue" value={<Money paise={k.revenuePaise} />} hint={`${k.changePct >= 0 ? '+' : ''}${k.changePct}% vs previous period`} />
              <Stat label="Bookings" value={k.bookingsCount} hint={`${k.utilisationPct}% court utilisation`} />
              <Stat label="New members" value={k.newMembers} />
              <Stat label="Shop orders · bar tabs" value={`${k.shopOrdersCount} · ${k.barTabsCount}`} />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">Revenue by source</h2>{data.bySource.length ? <BarList rows={data.bySource.map((s) => ({ label: humanize(s.source), value: s.amountPaise }))} /> : <p className="text-sm text-muted-foreground">No sales in this period.</p>}</section>
              <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">Revenue by payment method</h2>{data.byMethod.length ? <BarList rows={data.byMethod.map((m) => ({ label: humanize(m.method), value: m.amountPaise }))} /> : <p className="text-sm text-muted-foreground">No payments in this period.</p>}</section>
            </div>
            <section className="space-y-3 rounded-lg border p-5"><h2 className="text-lg font-semibold">Revenue over time</h2>{trend.length ? <BarList rows={trend} /> : <p className="text-sm text-muted-foreground">No data yet.</p>}</section>
            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-2 rounded-lg border p-5"><h2 className="text-lg font-semibold">What we owe</h2>
                <dl className="divide-y text-sm">
                  <div className="flex justify-between py-2"><dt className="text-muted-foreground">Tax payable</dt><dd><Money paise={data.owed.taxPayablePaise} /></dd></div>
                  <div className="flex justify-between py-2"><dt className="text-muted-foreground">Payroll due (monthly)</dt><dd><Money paise={data.owed.payrollDuePaise} /></dd></div>
                  <div className="flex justify-between py-2"><dt className="text-muted-foreground">Unpaid invoices</dt><dd><Money paise={data.owed.unpaidInvoicesPaise} /> ({data.owed.overdueInvoicesCount} overdue)</dd></div>
                </dl></section>
              <section className="space-y-2 rounded-lg border p-5"><h2 className="text-lg font-semibold">Needs attention</h2>
                <ul className="divide-y text-sm">
                  <li className="flex justify-between py-2"><span>Low stock products</span><span className="tabular">{data.alerts.lowStockCount}</span></li>
                  <li className="flex justify-between py-2"><span>Memberships expiring soon</span><span className="tabular">{data.alerts.expiringMembershipsCount}</span></li>
                  <li className="flex justify-between py-2"><span>New leads</span><span className="tabular">{data.alerts.newLeadsCount}</span></li>
                  <li className="flex justify-between py-2"><span>Leave awaiting a decision</span><span className="tabular">{data.alerts.pendingLeaveCount}</span></li>
                </ul></section>
            </div>
          </div>
        )}
      </QueryState>
      <ShareDialog key={String(sharing)} open={sharing} onClose={() => setSharing(false)} range={range} />
    </div>
  );
}
