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
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/app-shell/empty-state';
import { StatTile } from './stat-tile';
import { ReportCharts } from './charts';
import { PageError } from './page-error';
import { ClubSiteLink } from './club-site-link';

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
    { label: 'New booking', href: '/courts', show: can('bookings:create') && can('bookings:read') },
    { label: 'Counter sale', href: '/pos', show: can('orders:create') && can('products:read') },
    { label: 'Add member', href: '/members/new', show: can('members:create') && can('memberships:create') },
    { label: 'Create invoice', href: '/invoices/new', show: can('invoices:create') },
  ].filter(action => action.show);
  const alerts = [
    { label: 'products low in stock', count: report.alerts.lowStockCount, href: '/inventory', show: can('inventory:read') && can('products:read') },
    { label: 'memberships expiring', count: report.alerts.expiringMembershipsCount, href: '/members', show: can('members:read') },
    { label: 'new leads', count: report.alerts.newLeadsCount, href: '/crm', show: can('crm:read') },
    { label: 'leave requests pending', count: report.alerts.pendingLeaveCount, href: '/hr', show: can('hr:read') },
    { label: 'orders waiting to be handed over', count: pending.data ?? 0, href: '/orders', show: canOrder },
  ].filter(alert => alert.show && alert.count > 0);
  return <div className="space-y-8">
    <section className="space-y-4" aria-labelledby="today-heading">
      <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="today-heading" className="text-lg font-semibold">Today at the club</h2><Link className={buttonVariants({ variant: 'outline' })} href="/reports">View reports</Link></div>
      <p className="text-sm text-muted-foreground">Showing {report.to}. Updated <time dateTime={report.generatedAt}>{formatDateTime(report.generatedAt)}</time>.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue today" value={formatMoney(report.kpis.revenuePaise)} hint={`${report.kpis.changePct > 0 ? '+' : ''}${report.kpis.changePct}% vs previous club day`} />
        <StatTile label="Bookings today" value={report.kpis.bookingsCount} />
        <StatTile label="Court occupancy" value={`${report.kpis.utilisationPct}%`} />
        <StatTile label="Shop orders today" value={report.kpis.shopOrdersCount} />
        <StatTile label="New members today" value={report.kpis.newMembers} />
        <StatTile label="New leads" value={report.alerts.newLeadsCount} />
        <StatTile label="Bar tabs today" value={report.kpis.barTabsCount} />
        {canRoster && (shifts.isPending ? <div role="status" aria-label="Loading staff count"><Skeleton className="h-28" /></div> : <StatTile label="Staff on shift" value={staffCount ?? 'Unavailable'} hint={<Link className="underline underline-offset-4" href="/shifts">View roster</Link>} />)}
      </div>
      {canRoster && shifts.error && <PageError error={shifts.error} onRetry={() => { void shifts.refetch(); }} />}
    </section>
    {actions.length > 0 && <section className="space-y-4" aria-labelledby="actions-heading"><h2 id="actions-heading" className="text-lg font-semibold">Quick actions</h2><div className="flex flex-wrap gap-2">{actions.map(action => <Link key={action.href} href={action.href} className={buttonVariants({ variant: 'outline' })}>{action.label}</Link>)}</div></section>}
    <section className="space-y-4" aria-labelledby="attention-heading"><h2 id="attention-heading" className="text-lg font-semibold">Needs attention</h2>
      {canOrder && pending.isPending && <Skeleton className="h-8" aria-label="Loading order alerts" />}
      {canOrder && pending.error && <PageError error={pending.error} onRetry={() => { void pending.refetch(); }} />}
      {alerts.length ? <ul className="divide-y">{alerts.map(alert => <li key={alert.href} className="py-3"><Link className="underline underline-offset-4" href={alert.href}>{alert.count} {alert.label}</Link></li>)}</ul> : canOrder && (pending.isPending || pending.error) ? null : <p className="text-sm text-muted-foreground">No alerts in the areas you can access.</p>}
    </section>
    <section className="space-y-4"><h2 className="text-lg font-semibold">Today's revenue</h2>{report.kpis.revenuePaise === 0 ? <EmptyState title="No revenue today" description="Recorded payments will appear here." /> : <ReportCharts report={report} />}</section>
    <div className="grid min-w-0 gap-8 lg:grid-cols-2">
      {canBook && <section className="min-w-0 space-y-4" aria-labelledby="upcoming-heading"><h2 id="upcoming-heading" className="text-lg font-semibold">Upcoming bookings today</h2>
        {bookings.error ? <PageError error={bookings.error} onRetry={() => { void bookings.refetch(); }} /> : bookings.isPending ? <Skeleton className="h-40" aria-label="Loading bookings" /> : upcoming.length ? <ul className="divide-y">{upcoming.map(booking => <li key={booking.id} className="space-y-1 py-3"><p className="break-words font-medium">{booking.court.name}</p><p className="text-sm text-muted-foreground">{booking.member?.fullName ?? booking.guest?.name ?? 'Court booking'} · {formatDateTime(booking.startsAt)}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No upcoming bookings in this preview.</p>}
        {bookings.data?.meta.hasNextPage && <p className="text-sm text-muted-foreground">More bookings are available in the full schedule.</p>}
        <Link href="/bookings" className="underline underline-offset-4">View bookings</Link>
      </section>}
      {canOrder && <section className="min-w-0 space-y-4" aria-labelledby="activity-heading"><h2 id="activity-heading" className="text-lg font-semibold">Recent order activity</h2>
        {orders.error ? <PageError error={orders.error} onRetry={() => { void orders.refetch(); }} /> : orders.isPending ? <Skeleton className="h-40" aria-label="Loading orders" /> : orders.data?.data.length ? <ul className="divide-y">{orders.data.data.map(order => <li key={order.id} className="space-y-1 py-3"><p className="break-words font-medium">{order.orderNumber} · {formatMoney(order.totalPaise)}</p><p className="text-sm text-muted-foreground">{order.status.toLowerCase().replaceAll('_', ' ')} · {formatDateTime(order.createdAt)}</p></li>)}</ul> : <EmptyState title="No orders yet" description="Orders will appear after a sale or checkout." />}
        <Link href="/orders" className="underline underline-offset-4">View orders</Link>
      </section>}
    </div>
    <OwnerOverviewPanel />
    <ClubSiteLink />
  </div>;
}
