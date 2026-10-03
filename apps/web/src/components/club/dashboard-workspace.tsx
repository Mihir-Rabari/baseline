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
import { PageError } from './page-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatDate } from '@/lib/format';
import { toast } from 'sonner';
export function DashboardWorkspace() {
  const { hasPermission } = useAuth();
  const owner = hasPermission('reports:read'); const desk = !owner && hasPermission('members:read') && hasPermission('orders:create'); const bar = !owner && !desk && hasPermission('bar:read'); const member = !owner && !desk && !bar && hasPermission('bookings:read:self');
  const [selected, setSelected] = useState<MemberLookupItem | null>(null); const client = useQueryClient();
  const report = useQuery({ queryKey: ['reports', 'today'], queryFn: () => reportApi.dashboard('today'), enabled: owner, refetchInterval: 10000 });
  const deskData = useQuery({ queryKey: ['desk-dashboard', hasPermission('bookings:read'), (hasPermission('inventory:read') && hasPermission('products:read')), hasPermission('crm:read')], enabled: desk, queryFn: async () => { const [bookings, products, leads] = await Promise.all([hasPermission('bookings:read') ? bookingApi.list('upcoming', todayAtClub()) : null, (hasPermission('inventory:read') && hasPermission('products:read')) ? shopApi.products({ lowStock: 'true' }) : null, hasPermission('crm:read') ? crmApi.summary() : null]); return { bookings: bookings?.meta.totalItems ?? null, stock: products?.meta.totalItems ?? null, leads: leads?.byStatus.NEW ?? null }; } });
  const barData = useQuery({ queryKey: ['bar-dashboard', hasPermission('bar:kitchen')], enabled: bar, refetchInterval: 5000, queryFn: async () => { const [tables, tickets, shift] = await Promise.all([barApi.tables(), hasPermission('bar:kitchen') ? barApi.tickets() : [], hrApi.currentShift()]); return { tables, tickets, shift }; } });
  const memberData = useQuery({ queryKey: ['member-dashboard'], enabled: member, queryFn: async () => { const [membership, bookings] = await Promise.all([bookingApi.member(), bookingApi.list('upcoming')]); return { membership, booking: bookings.data[0] }; } });
  const clock = useMutation({ mutationFn: async () => { const shift = barData.data?.shift; if (!shift) return; return shift.clockInAt ? hrApi.clockOut(shift.id) : hrApi.clockIn(shift.id); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ['bar-dashboard'] }); }, onError: error => toast.error(error.message) });
  const active = owner ? report : desk ? deskData : bar ? barData : memberData;
  if (!owner && !desk && !bar && !member) return null;
  if (active.isPending) return <div role="status" aria-label="Loading workspace"><Skeleton className="h-32" /></div>;
  if (active.error) return <PageError error={active.error} onRetry={() => { void active.refetch(); }} />;
  return <section className="space-y-4 border-b pb-6"><h2 className="text-lg font-semibold">Your club workspace</h2>{owner && report.data && <><ClubSiteLink /><Link className={buttonVariants()} href="/reports">View reports</Link><p className="text-sm text-muted-foreground">{report.data.alerts.lowStockCount} products low in stock · {report.data.alerts.newLeadsCount} new leads · {report.data.alerts.pendingLeaveCount} leave requests pending</p></>}{desk && <><MemberSearch value={selected} onChange={setSelected} />{selected && <Link className={buttonVariants({ variant: 'outline' })} href={`/members/${selected.id}`}>Open member profile</Link>}{deskData.data && <div className="grid gap-6 sm:grid-cols-3"><StatTile label="Today's bookings" value={deskData.data.bookings ?? 'Unavailable'} /><StatTile label="Low stock" value={deskData.data.stock ?? 'Unavailable'} /><StatTile label="New leads" value={deskData.data.leads ?? 'Unavailable'} /></div>}</>}{bar && barData.data && <><div className="grid gap-6 sm:grid-cols-2"><StatTile label="Open tabs" value={barData.data.tables.filter(table => table.status === 'OCCUPIED').length} /><StatTile label="Tickets waiting" value={barData.data.tickets.filter(ticket => ['NEW', 'PREPARING', 'READY'].includes(ticket.status)).length} /></div>{barData.data.shift ? <div className="flex flex-wrap items-center gap-4"><p>Current shift: {barData.data.shift.roleLabel} · {formatDateTime(barData.data.shift.startsAt)}</p>{hasPermission('shifts:clock:self') && !barData.data.shift.clockOutAt && <Button disabled={clock.isPending} onClick={() => clock.mutate()}>{barData.data.shift.clockInAt ? 'Clock out' : 'Clock in'}</Button>}</div> : <p className="text-sm text-muted-foreground">No shift scheduled.</p>}</>}{member && memberData.data && <><p>{memberData.data.membership.membership ? `${memberData.data.membership.membership.plan.name} membership ends ${formatDate(memberData.data.membership.membership.endsOn)}` : 'No active membership'}</p>{memberData.data.booking && <p>Next booking: {memberData.data.booking.court.name}, {formatDateTime(memberData.data.booking.startsAt)}</p>}<div className="flex gap-2"><Link href="/courts" className={buttonVariants()}>Book a court</Link><Link href="/shop" className={buttonVariants({ variant: 'outline' })}>Shop</Link></div></>}</section>;
}


