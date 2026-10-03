'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { Booking, BarEarnings, CrmSummary, DashboardReport, Member, Shift, Ticket } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { calendarDate } from '@/lib/booking-calendar';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { qs, type Page } from '@/lib/ops';
import { AreaChart } from '@/components/dashboard/area-chart';
import { CountUp } from '@/components/dashboard/count-up';
import { ProfilePanel } from '@/components/profile/profile-panel';
import { PageHeader } from '@/components/app-shell/page-header';
import { StatusBadge } from '@/components/club/status-badge';
import { humanize } from '@/components/club/ops-bits';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const rupees = (n: number) => formatMoney(Math.round(n));

function Tile({ label, value, hint, href, loading }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; loading?: boolean }) {
  const body = (
    <div className={cn('h-full rounded-lg border bg-card p-4 transition-all duration-200', href && 'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm')}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-2xl font-semibold">{value}</p>}
      {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3 rounded-lg border bg-card p-5', className)} aria-label={title}>
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

const grid = 'grid gap-4 [&>*]:animate-rise [&>*:nth-child(2)]:[animation-delay:60ms] [&>*:nth-child(3)]:[animation-delay:120ms] [&>*:nth-child(4)]:[animation-delay:180ms]';

function OwnerOverview() {
  const report = useOpsQuery<DashboardReport>(['reports', 'dashboard', 'week'], '/reports/dashboard?range=week', { refetchMs: 30000 });
  const d = report.data;
  const k = d?.kpis;
  const alerts = d ? [
    { label: 'Low stock products', n: d.alerts.lowStockCount, href: '/inventory' },
    { label: 'Memberships expiring soon', n: d.alerts.expiringMembershipsCount, href: '/members' },
    { label: 'New leads', n: d.alerts.newLeadsCount, href: '/crm' },
    { label: 'Leave awaiting a decision', n: d.alerts.pendingLeaveCount, href: '/hr' },
    { label: 'Overdue invoices', n: d.owed.overdueInvoicesCount, href: '/invoices' },
  ] : [];
  return (
    <div className="space-y-4">
      <div className={cn(grid, 'grid-cols-2 lg:grid-cols-4')}>
        <Tile label="Revenue this week" loading={!k} value={k && <CountUp value={k.revenuePaise} format={rupees} />} hint={k && `${k.changePct >= 0 ? '+' : ''}${k.changePct}% vs last week`} href="/reports" />
        <Tile label="Bookings" loading={!k} value={k && <CountUp value={k.bookingsCount} />} hint={k && `${k.utilisationPct}% of court time used`} href="/bookings" />
        <Tile label="New members" loading={!k} value={k && <CountUp value={k.newMembers} />} href="/members" />
        <Tile label="Shop orders · bar tabs" loading={!k} value={k && <><CountUp value={k.shopOrdersCount} /> · <CountUp value={k.barTabsCount} /></>} href="/orders" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Revenue, last 7 days" action={<Link href="/reports" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Full report</Link>} className="animate-rise">
          {!d ? <Skeleton className="h-40 w-full" /> : d.trend.length === 0 ? <p className="text-sm text-muted-foreground">No sales yet this week.</p> : <AreaChart ariaLabel="Revenue by day for the last 7 days" format={formatMoney} points={d.trend.map((t) => ({ label: t.bucket.slice(5), value: t.totalPaise }))} />}
        </Panel>
        <Panel title="Needs attention" className="animate-rise [animation-delay:80ms]">
          {!d ? <Skeleton className="h-32 w-full" /> : (
            <ul className="divide-y text-sm">
              {alerts.map((a) => (
                <li key={a.label}><Link href={a.href} className="flex items-center justify-between py-2 transition-colors hover:text-primary"><span>{a.label}</span><span className={cn('tabular rounded-full px-2 py-0.5 text-xs', a.n > 0 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground')}>{a.n}</span></Link></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function TodayAtTheClub() {
  const today = calendarDate();
  const bookings = useOpsQuery<Page<Booking>>(['bookings', 'day', today], `/bookings${qs({ date: today, limit: 50 })}`, { refetchMs: 30000 });
  const rows = (bookings.data?.data ?? []).filter((b) => b.status !== 'CANCELLED').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <Panel title="Today at the club" action={<Link href="/bookings" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>All bookings</Link>} className="animate-rise">
      {bookings.isPending ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No bookings today. <Link href="/courts" className="underline underline-offset-4">Book a court</Link></p> : (
        <ul className="divide-y text-sm">
          {rows.slice(0, 8).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <span className="tabular w-20 text-muted-foreground">{new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(b.startsAt))}</span>
              <span className="min-w-0 flex-1 truncate">{b.court.name} · {b.member?.fullName ?? b.guest?.name ?? 'Walk-in'}</span>
              <StatusBadge kind="booking" value={b.status} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FrontDeskTiles({ crm, stock }: { crm: boolean; stock: boolean }) {
  const summary = useOpsQuery<CrmSummary>(['crm', 'summary'], '/crm/summary', { enabled: crm, refetchMs: 60000 });
  const low = useOpsQuery<Page<unknown>>(['products', 'low-count'], '/products?lowStock=true&limit=1', { enabled: stock, refetchMs: 60000 });
  return (
    <div className={cn(grid, 'grid-cols-2 lg:grid-cols-4')}>
      {crm && <Tile label="New leads" loading={!summary.data} value={summary.data && <CountUp value={summary.data.byStatus.NEW} />} hint={summary.data && `${summary.data.dueToday} follow-ups due today`} href="/crm" />}
      {crm && <Tile label="Lead conversion" loading={!summary.data} value={summary.data && <CountUp value={summary.data.conversionRatePct} format={(n) => `${Math.round(n * 10) / 10}%`} />} href="/crm" />}
      {stock && <Tile label="Low stock products" loading={!low.data} value={low.data && <CountUp value={low.data.meta.totalItems} />} href="/inventory" />}
    </div>
  );
}

function BarTiles() {
  const today = calendarDate();
  const tabs = useOpsQuery<Page<unknown>>(['bar', 'tabs', 'count'], '/bar/tabs?status=OPEN&limit=1', { refetchMs: 10000 });
  const tickets = useOpsQuery<Ticket[]>(['bar', 'tickets', 'count'], '/bar/tickets', { refetchMs: 10000 });
  const earnings = useOpsQuery<BarEarnings>(['bar', 'earnings', today], `/bar/earnings${qs({ date: today })}`, { refetchMs: 30000 });
  return (
    <div className={cn(grid, 'grid-cols-2 lg:grid-cols-4')}>
      <Tile label="Open bar tabs" loading={!tabs.data} value={tabs.data && <CountUp value={tabs.data.meta.totalItems} />} href="/bar" />
      <Tile label="In the kitchen" loading={!tickets.data} value={tickets.data && <CountUp value={tickets.data.length} />} hint="Tickets waiting" href="/bar/kitchen" />
      <Tile label="Bar takings today" loading={!earnings.data} value={earnings.data && <CountUp value={earnings.data.totalPaise} format={rupees} />} hint={earnings.data && `${earnings.data.tabsSettled} tabs settled`} href="/bar/earnings" />
    </div>
  );
}

function MyShiftPanel() {
  const current = useOpsQuery<Shift | null>(['shifts', 'current'], '/me/shift/current', { refetchMs: 30000 });
  const clockIn = useOpsMutation<Shift, { id: string }>('post', ['shifts', 'bar'], (v) => `/shifts/${v.id}/clock-in`);
  const clockOut = useOpsMutation<Shift, { id: string }>('post', ['shifts', 'bar'], (v) => `/shifts/${v.id}/clock-out`);
  const shift = current.data;
  async function run(action: () => Promise<unknown>, done: string) { try { await action(); toast.success(done); } catch (e) { toast.error(e instanceof Error ? e.message : 'That did not work.'); } }
  return (
    <Panel title="My shift" action={<Link href="/shifts" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Roster</Link>} className="animate-rise">
      {current.isPending ? <Skeleton className="h-12 w-full" /> : !shift ? <p className="text-sm text-muted-foreground">No shift to clock into right now.</p> : (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div><p className="font-medium">{humanize(shift.roleLabel)}</p><p className="text-muted-foreground">{formatDateTime(shift.startsAt)} to {formatDateTime(shift.endsAt)}</p></div>
          {shift.status === 'SCHEDULED' && <Button loading={clockIn.isPending} onClick={() => { void run(() => clockIn.mutateAsync({ id: shift.id }), 'Clocked in'); }}>Clock in</Button>}
          {shift.status === 'ON_SHIFT' && <Button variant="outline" loading={clockOut.isPending} onClick={() => { void run(() => clockOut.mutateAsync({ id: shift.id }), 'Clocked out'); }}>Clock out</Button>}
        </div>
      )}
    </Panel>
  );
}

function MemberPanels() {
  const upcoming = useOpsQuery<Page<Booking>>(['bookings', 'mine', 'upcoming', 'dash'], '/me/bookings?scope=upcoming&limit=3');
  const member = useOpsQuery<Member>(['members', 'me'], '/me/member');
  const next = upcoming.data?.data[0];
  const m = member.data?.membership;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Your next booking" action={<Link href="/bookings" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>All bookings</Link>} className="animate-rise">
        {upcoming.isPending ? <Skeleton className="h-16 w-full" /> : !next ? <div className="space-y-3"><p className="text-sm text-muted-foreground">You have nothing booked.</p><Link href="/courts" className={buttonVariants()}>Book a court</Link></div> : (
          <div className="space-y-1 text-sm"><p className="text-lg font-semibold">{next.court.name}</p><p className="text-muted-foreground">{formatDateTime(next.startsAt)}</p>{upcoming.data!.meta.totalItems > 1 && <p className="text-muted-foreground">{upcoming.data!.meta.totalItems - 1} more coming up</p>}</div>
        )}
      </Panel>
      <Panel title="Your membership" action={<Link href="/membership" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Details</Link>} className="animate-rise [animation-delay:80ms]">
        {member.isPending ? <Skeleton className="h-16 w-full" /> : !m ? <p className="text-sm text-muted-foreground">No active membership. <Link href="/plans" className="underline underline-offset-4">See plans</Link></p> : (
          <div className="space-y-1 text-sm"><p className="text-lg font-semibold">{m.plan.name}</p><p className="text-muted-foreground">Ends {formatDate(`${m.endsOn}T12:00:00+05:30`)} · <span className="tabular">{Math.max(0, m.daysLeft)}</span> days left</p><StatusBadge kind="membership" value={m.expiryState} /></div>
        )}
      </Panel>
    </div>
  );
}

function Overview() {
  const { user, hasPermission } = useAuth();
  const owner = hasPermission('reports:read');
  const desk = hasPermission('bookings:read');
  const bar = hasPermission('bar:read');
  const crm = hasPermission('crm:read');
  const stock = hasPermission('inventory:read');
  const clocks = hasPermission('shifts:clock:self');
  const member = hasPermission('bookings:read:self') && !desk;
  const actions = [
    { href: '/courts', label: 'Book a court', show: hasPermission('bookings:create') || hasPermission('bookings:create:self') },
    { href: '/members/new', label: 'New member', show: hasPermission('members:create') },
    { href: '/pos', label: 'Counter sale', show: hasPermission('orders:create') },
    { href: '/bar', label: 'Open a tab', show: hasPermission('bar:manage') },
    { href: '/crm', label: 'Add a lead', show: hasPermission('crm:manage') },
  ].filter((a) => a.show);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-2xl font-semibold tracking-tight">{greeting()}, {user?.name?.split(' ')[0] || 'there'}</h2><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p></div>
        <div className="flex flex-wrap gap-2">{actions.map((a, i) => <Link key={a.href} href={a.href} className={buttonVariants({ variant: i === 0 ? 'default' : 'outline' })}>{a.label}</Link>)}</div>
      </div>
      {owner && <OwnerOverview />}
      {(crm || stock) && !owner && <FrontDeskTiles crm={crm} stock={stock} />}
      {bar && <BarTiles />}
      <div className="grid gap-4 lg:grid-cols-2">
        {desk && <TodayAtTheClub />}
        {clocks && <MyShiftPanel />}
      </div>
      {member && <MemberPanels />}
      {!owner && !desk && !bar && !member && !clocks && <p className="text-sm text-muted-foreground">Nothing to show for your role yet. Ask the owner to give your account a role.</p>}
    </div>
  );
}

function DashboardTabs() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'profile' ? 'profile' : 'overview');
  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="What is happening at the club today, and your account." />
      <Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Dashboard sections"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="profile">Profile</TabsTrigger></TabsList></Tabs>
      <div key={tab} className="animate-rise">{tab === 'overview' ? <Overview /> : <ProfilePanel />}</div>
    </div>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}><DashboardTabs /></Suspense>;
}
