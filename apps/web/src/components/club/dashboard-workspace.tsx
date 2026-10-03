'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberLookupItem } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { bookingApi, todayAtClub } from '@/lib/booking-api';
import { shopApi } from '@/lib/shop-api';
import { barApi } from '@/lib/bar-api';
import { reportApi } from '@/lib/report-api';
import { crmApi } from '@/lib/crm-api';
import { hrApi } from '@/lib/hr-api';
import { MemberSearch } from './member-search';
import { StatTile } from './stat-tile';
import { ClubSiteLink } from './club-site-link';
import { OwnerOverviewPanel } from './owner-overview';
import { PageError } from './page-error';
import { Money } from '@/components/club/money';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatDate } from '@/lib/format';
import { toast } from 'sonner';
import {
  Activity,
  Calendar,
  Clock,
  Coffee,
  FileText,
  IndianRupee,
  Package,
  ShoppingBag,
  Users,
} from 'lucide-react';

export function DashboardWorkspace() {
  const { hasPermission } = useAuth();
  const owner = hasPermission('reports:read');
  const desk = !owner && hasPermission('members:read') && hasPermission('orders:create');
  const bar = !owner && !desk && hasPermission('bar:read');
  const member = !owner && !desk && !bar && hasPermission('bookings:read:self');

  const [selected, setSelected] = useState<MemberLookupItem | null>(null);
  const client = useQueryClient();

  const report = useQuery({
    queryKey: ['reports', 'today'],
    queryFn: () => reportApi.dashboard('today'),
    enabled: owner,
    refetchInterval: 10000,
  });

  const deskData = useQuery({
    queryKey: [
      'desk-dashboard',
      hasPermission('bookings:read'),
      hasPermission('inventory:read') && hasPermission('products:read'),
      hasPermission('crm:read'),
    ],
    enabled: desk,
    queryFn: async () => {
      const [bookings, products, leads] = await Promise.all([
        hasPermission('bookings:read') ? bookingApi.list('upcoming', todayAtClub()) : null,
        hasPermission('inventory:read') && hasPermission('products:read')
          ? shopApi.products({ lowStock: 'true' })
          : null,
        hasPermission('crm:read') ? crmApi.summary() : null,
      ]);
      return {
        bookings: bookings?.meta.totalItems ?? null,
        stock: products?.meta.totalItems ?? null,
        leads: leads?.byStatus.NEW ?? null,
      };
    },
  });

  const barData = useQuery({
    queryKey: ['bar-dashboard', hasPermission('bar:kitchen')],
    enabled: bar,
    refetchInterval: 5000,
    queryFn: async () => {
      const [tables, tickets, shift] = await Promise.all([
        barApi.tables(),
        hasPermission('bar:kitchen') ? barApi.tickets() : [],
        hrApi.currentShift(),
      ]);
      return { tables, tickets, shift };
    },
  });

  const memberData = useQuery({
    queryKey: ['member-dashboard'],
    enabled: member,
    queryFn: async () => {
      const [membership, bookings] = await Promise.all([
        bookingApi.member(),
        bookingApi.list('upcoming'),
      ]);
      return { membership, booking: bookings.data[0] };
    },
  });

  const clock = useMutation({
    mutationFn: async () => {
      const shift = barData.data?.shift;
      if (!shift) return;
      return shift.clockInAt ? hrApi.clockOut(shift.id) : hrApi.clockIn(shift.id);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['bar-dashboard'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const active = owner ? report : desk ? deskData : bar ? barData : memberData;

  if (!owner && !desk && !bar && !member) return null;
  if (active.isPending)
    return (
      <div role="status" aria-label="Loading workspace" className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  if (active.error) return <PageError error={active.error} onRetry={() => { void active.refetch(); }} />;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Your club workspace</h2>
        <span className="text-xs text-muted-foreground">Club Time: IST</span>
      </div>

      {owner && report.data && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <ClubSiteLink />
            <div className="flex flex-wrap items-center gap-2">
              <Link className={buttonVariants()} href="/reports">
                View reports
              </Link>
              <Link className={buttonVariants({ variant: 'outline' })} href="/courts">
                Courts
              </Link>
              <Link className={buttonVariants({ variant: 'outline' })} href="/pos">
                POS
              </Link>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {report.data.alerts.lowStockCount} products low in stock · {report.data.alerts.newLeadsCount} new leads · {report.data.alerts.pendingLeaveCount} leave requests pending
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Today&apos;s Revenue</span>
                <IndianRupee className="h-4 w-4" />
              </div>
              <div className="flex items-baseline justify-between">
                <p className="text-2xl font-bold tracking-tight">
                  <Money paise={report.data.kpis?.revenuePaise ?? 0} />
                </p>
                {report.data.kpis?.changePct !== undefined && (
                  <Badge variant={report.data.kpis.changePct >= 0 ? 'success' : 'destructive'} className="text-xs">
                    {report.data.kpis.changePct >= 0 ? '+' : ''}{report.data.kpis.changePct}%
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">vs previous period</p>
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Court Utilisation</span>
                <Activity className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold tracking-tight">
                {report.data.kpis?.utilisationPct ?? 0}%
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, report.data.kpis?.utilisationPct ?? 0))}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Bookings Today</span>
                <Calendar className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold tracking-tight tabular">
                {report.data.kpis?.bookingsCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">sessions scheduled</p>
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">New Members</span>
                <Users className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold tracking-tight tabular">
                {report.data.kpis?.newMembers ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">signed up recently</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Link
              href="/inventory"
              className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm"
            >
              <div className="rounded-md bg-warning/10 p-2 text-warning">
                <Package className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold group-hover:text-primary">Inventory</h4>
                <p className="text-xs text-muted-foreground">
                  {report.data.alerts.lowStockCount > 0
                    ? `${report.data.alerts.lowStockCount} items need restocking`
                    : 'Stock levels healthy'}
                </p>
              </div>
            </Link>

            <Link
              href="/crm"
              className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm"
            >
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold group-hover:text-primary">CRM Leads</h4>
                <p className="text-xs text-muted-foreground">
                  {report.data.alerts.newLeadsCount > 0
                    ? `${report.data.alerts.newLeadsCount} new enquiries to follow up`
                    : 'All enquiries reviewed'}
                </p>
              </div>
            </Link>

            <Link
              href="/hr"
              className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm"
            >
              <div className="rounded-md bg-blue-500/10 p-2 text-blue-500">
                <Clock className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold group-hover:text-primary">Staff & Leave</h4>
                <p className="text-xs text-muted-foreground">
                  {report.data.alerts.pendingLeaveCount > 0
                    ? `${report.data.alerts.pendingLeaveCount} leave requests pending decision`
                    : 'No pending leave requests'}
                </p>
              </div>
            </Link>
          </div>

          <OwnerOverviewPanel />

          <div className="rounded-xl border bg-muted/20 p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Management</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Link href="/courts" className="flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-3 text-center transition hover:bg-accent">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Courts</span>
              </Link>
              <Link href="/members" className="flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-3 text-center transition hover:bg-accent">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Members</span>
              </Link>
              <Link href="/pos" className="flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-3 text-center transition hover:bg-accent">
                <ShoppingBag className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">POS Register</span>
              </Link>
              <Link href="/bar" className="flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-3 text-center transition hover:bg-accent">
                <Coffee className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Bar & Kitchen</span>
              </Link>
              <Link href="/invoices" className="flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-3 text-center transition hover:bg-accent">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Invoices</span>
              </Link>
              <Link href="/shifts" className="flex flex-col items-center justify-center gap-1.5 rounded-lg border bg-card p-3 text-center transition hover:bg-accent">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Shifts Roster</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {desk && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
            <h3 className="font-semibold text-sm">Quick Member Lookup & Check-in</h3>
            <MemberSearch value={selected} onChange={setSelected} />
            {selected && (
              <div className="pt-2">
                <Link className={buttonVariants({ variant: 'outline' })} href={`/members/${selected.id}`}>
                  Open member profile
                </Link>
              </div>
            )}
          </div>

          {deskData.data && (
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Today's bookings" value={deskData.data.bookings ?? 'Unavailable'} />
              <StatTile label="Low stock" value={deskData.data.stock ?? 'Unavailable'} />
              <StatTile label="New leads" value={deskData.data.leads ?? 'Unavailable'} />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link href="/courts" className={buttonVariants()}>
              Book court for player
            </Link>
            <Link href="/pos" className={buttonVariants({ variant: 'outline' })}>
              Counter POS
            </Link>
            <Link href="/members/new" className={buttonVariants({ variant: 'outline' })}>
              Register new member
            </Link>
          </div>
        </div>
      )}

      {bar && barData.data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="Open tabs"
              value={barData.data.tables.filter((table) => table.status === 'OCCUPIED').length}
            />
            <StatTile
              label="Tickets waiting"
              value={
                barData.data.tickets.filter((ticket) =>
                  ['NEW', 'PREPARING', 'READY'].includes(ticket.status)
                ).length
              }
            />
          </div>

          <div className="rounded-xl border bg-card p-4 shadow-sm">
            {barData.data.shift ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium">
                    Current shift: {barData.data.shift.roleLabel.replaceAll('_', ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Started: {formatDateTime(barData.data.shift.startsAt)}
                  </p>
                </div>
                {hasPermission('shifts:clock:self') && !barData.data.shift.clockOutAt && (
                  <Button disabled={clock.isPending} onClick={() => clock.mutate()}>
                    {barData.data.shift.clockInAt ? 'Clock out' : 'Clock in'}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No shift scheduled.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/bar" className={buttonVariants()}>
              Bar Floor & Tabs
            </Link>
            <Link href="/bar/kitchen" className={buttonVariants({ variant: 'outline' })}>
              Kitchen Display
            </Link>
          </div>
        </div>
      )}

      {member && memberData.data && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
            <h3 className="font-semibold text-sm">Membership Status</h3>
            <p className="text-base font-medium">
              {memberData.data.membership.membership
                ? `${memberData.data.membership.membership.plan.name} membership ends ${formatDate(
                    memberData.data.membership.membership.endsOn
                  )}`
                : 'No active membership'}
            </p>
            {memberData.data.booking && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Next Upcoming Session</span>
                <p className="text-sm font-semibold">
                  {memberData.data.booking.court.name} · {formatDateTime(memberData.data.booking.startsAt)}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/courts" className={buttonVariants()}>
                Book a court
              </Link>
              <Link href="/shop" className={buttonVariants({ variant: 'outline' })}>
                Shop
              </Link>
              <Link href="/bookings" className={buttonVariants({ variant: 'outline' })}>
                My bookings
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
