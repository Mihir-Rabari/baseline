'use client';

import { OwnerOverviewPanel } from './owner-overview';
import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { DashboardReport } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { bookingApi, todayAtClub } from '@/lib/booking-api';
import { shopApi } from '@/lib/shop-api';
import { hrApi } from '@/lib/hr-api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { CalendarPlus, ChevronRight, FileText, UserPlus, ShoppingBag, IndianRupee, CalendarDays, Gauge, Package, Users, Megaphone, GlassWater, UserCheck, Activity, Zap, BellRing, TrendingUp, CalendarClock, ReceiptText, type LucideIcon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/app-shell/empty-state';
import { StatTile } from './stat-tile';
import { SectionHeading } from './section-heading';
import { CountUp } from './count-up';
import { ReportCharts } from './charts';
import { PageError } from './page-error';

export function OwnerDashboard({ report }: { report: DashboardReport }) {
  const { hasPermission: can } = useAuth();
  const today = todayAtClub();
  const canBook = can('bookings:read');
  const canOrder = can('orders:read');
  const canRoster = can('shifts:read') && can('shifts:read:all');
  const bookings = useQuery({ queryKey: ['dashboard', 'bookings', today], queryFn: () => bookingApi.list('upcoming', today), enabled: canBook, refetchInterval: 30000 });
  const orders = useQuery({ queryKey: ['dashboard', 'orders'], queryFn: () => shopApi.orders({ limit: 5 }), enabled: canOrder, refetchInterval: 30000 });
  const pending = useQuery({ queryKey: ['dashboard', 'pending-orders'], queryFn: async () => {
    const pages = await Promise.all((['PLACED', 'READY', 'OUT_FOR_DELIVERY'] as const).map(status => shopApi.orders({ status, limit: 1 })));
    return pages.reduce((sum, page) => sum + page.meta.totalItems, 0);
  }, enabled: canOrder, refetchInterval: 30000 });
  const shifts = useQuery({ queryKey: ['dashboard', 'staff-on-shift'], queryFn: () => hrApi.shifts(), enabled: canRoster, refetchInterval: 30000 });
  // The roster endpoint caps its response at 500 rows. Never present a partial count as a total.
  const staffCount = shifts.data && shifts.data.length < 500 ? shifts.data.filter(shift => shift.status === 'ON_SHIFT').length : null;
  const upcoming = bookings.data?.data.filter(booking => booking.status === 'CONFIRMED' && Date.parse(booking.startsAt) >= Date.now()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 5) ?? [];
  const actions = [
    { label: 'New booking', icon: CalendarPlus, href: '/courts', show: can('bookings:create') && can('bookings:read') },
    { label: 'Counter sale', icon: ShoppingBag, href: '/pos', show: can('orders:create') && can('products:read') },
    { label: 'Add member', icon: UserPlus, href: '/members/new', show: can('members:create') && can('memberships:create') },
    { label: 'Create invoice', icon: FileText, href: '/invoices/new', show: can('invoices:create') },
  ].filter(action => action.show);
  const alerts = [
    { label: 'products low in stock', count: report.alerts.lowStockCount, href: '/inventory', show: can('inventory:read') && can('products:read') },
    { label: 'memberships expiring', count: report.alerts.expiringMembershipsCount, href: '/members', show: can('members:read') },
    { label: 'new leads', count: report.alerts.newLeadsCount, href: '/crm', show: can('crm:read') },
    { label: 'leave requests pending', count: report.alerts.pendingLeaveCount, href: '/hr', show: can('hr:read') },
    { label: 'orders waiting to be handed over', count: pending.data ?? 0, href: '/orders', show: canOrder },
  ].filter(alert => alert.show && alert.count > 0);
  return <div className="space-y-8">
    {actions.length > 0 && <section className="space-y-3" aria-labelledby="actions-heading"><SectionHeading id="actions-heading" icon={Zap} title="Quick actions" subtitle="Jump straight to the jobs you do most" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{actions.map(action => <Link key={action.href} href={action.href} className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-muted/50"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><action.icon className="size-4" aria-hidden /></span><span className="flex-1">{action.label}</span><ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden /></Link>)}</div></section>}
    <section className="space-y-4" aria-labelledby="today-heading">
      <SectionHeading id="today-heading" icon={Activity} title="Today at the club" subtitle={<>Live figures for {report.to}, refreshed every few seconds.</>} actions={<div className="flex items-center gap-3"><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="relative flex size-2"><span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex size-2 rounded-full bg-success" /></span>Live <time dateTime={report.generatedAt}>{formatDateTime(report.generatedAt)}</time></span><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/reports">View reports</Link></div>} />
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={IndianRupee} trend={report.kpis.changePct > 0 ? 'up' : report.kpis.changePct < 0 ? 'down' : 'flat'} label="Revenue today" value={<CountUp value={report.kpis.revenuePaise} format={formatMoney} />} hint={`${report.kpis.changePct > 0 ? '+' : ''}${report.kpis.changePct}% vs previous club day`} />
        <StatTile icon={CalendarDays} label="Bookings today" value={report.kpis.bookingsCount} />
        <StatTile icon={Gauge} label="Court occupancy" value={<CountUp value={report.kpis.utilisationPct} format={n => `${Math.round(n)}%`} />} />
        <StatTile icon={Package} label="Shop orders today" value={report.kpis.shopOrdersCount} />
        <StatTile icon={Users} label="New members today" value={report.kpis.newMembers} />
        <StatTile icon={Megaphone} label="New leads" value={report.alerts.newLeadsCount} />
        <StatTile icon={GlassWater} label="Bar tabs today" value={report.kpis.barTabsCount} />
        {canRoster && (shifts.isPending ? <div role="status" aria-label="Loading staff count"><Skeleton className="h-32 rounded-xl" /></div> : <StatTile icon={UserCheck} label="Staff on shift" value={staffCount ?? 'Unavailable'} hint={<Link className="underline underline-offset-4" href="/shifts">View roster</Link>} />)}
      </div>
      {canRoster && shifts.error && <PageError error={shifts.error} onRetry={() => { void shifts.refetch(); }} />}
    </section>
    <section className="space-y-3" aria-labelledby="attention-heading"><SectionHeading id="attention-heading" icon={BellRing} title="Needs attention" subtitle="Things waiting on you right now" />
      {canOrder && pending.isPending && <Skeleton className="h-8" aria-label="Loading order alerts" />}
      {canOrder && pending.error && <PageError error={pending.error} onRetry={() => { void pending.refetch(); }} />}
      {alerts.length ? <ul className="divide-y rounded-xl border bg-card">{alerts.map(alert => <li key={alert.href}><Link className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50" href={alert.href}><span className="tabular flex size-7 items-center justify-center rounded-full bg-warning/15 text-xs font-semibold text-warning">{alert.count}</span><span className="flex-1">{alert.label}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden /></Link></li>)}</ul> : canOrder && (pending.isPending || pending.error) ? null : <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">All clear. Nothing needs attention in the areas you can access.</p>}
    </section>
    <section className="space-y-4 rounded-xl border bg-card p-5"><SectionHeading icon={TrendingUp} title="Today's revenue" subtitle="Where the money came from and how it is trending" />{report.kpis.revenuePaise === 0 ? <EmptyState title="No revenue today" description="Recorded payments will appear here." /> : <ReportCharts report={report} />}</section>
    <div className="grid min-w-0 gap-8 lg:grid-cols-2">
      {canBook && <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5" aria-labelledby="upcoming-heading"><SectionHeading id="upcoming-heading" icon={CalendarClock} title="Upcoming bookings" subtitle="The next confirmed courts today" />
        {bookings.error ? <PageError error={bookings.error} onRetry={() => { void bookings.refetch(); }} /> : bookings.isPending ? <Skeleton className="h-40" aria-label="Loading bookings" /> : upcoming.length ? <ul className="divide-y">{upcoming.map(booking => <li key={booking.id} className="space-y-1 py-3"><p className="break-words font-medium">{booking.court.name}</p><p className="text-sm text-muted-foreground">{booking.member?.fullName ?? booking.guest?.name ?? 'Court booking'} · {formatDateTime(booking.startsAt)}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No upcoming bookings in this preview.</p>}
        {bookings.data?.meta.hasNextPage && <p className="text-sm text-muted-foreground">More bookings are available in the full schedule.</p>}
        <Link href="/bookings" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">View bookings</Link>
      </section>}
      {canOrder && <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5" aria-labelledby="activity-heading"><SectionHeading id="activity-heading" icon={ReceiptText} title="Recent orders" subtitle="The latest sales and checkouts" />
        {orders.error ? <PageError error={orders.error} onRetry={() => { void orders.refetch(); }} /> : orders.isPending ? <Skeleton className="h-40" aria-label="Loading orders" /> : orders.data?.data.length ? <ul className="divide-y">{orders.data.data.map(order => <li key={order.id} className="space-y-1 py-3"><p className="break-words font-medium">{order.orderNumber} · {formatMoney(order.totalPaise)}</p><p className="text-sm text-muted-foreground">{order.status.toLowerCase().replaceAll('_', ' ')} · {formatDateTime(order.createdAt)}</p></li>)}</ul> : <EmptyState title="No orders yet" description="Orders will appear after a sale or checkout." />}
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">View orders</Link>
      </section>}
    </div>
    <OwnerOverviewPanel />
  </div>;
}
