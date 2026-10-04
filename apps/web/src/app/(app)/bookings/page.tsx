'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { promiseFeePaise, type Booking } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useCancelBooking, useDayBookings, useMyBookings, useWeekBookings, type BookingScope } from '@/hooks/use-bookings';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { canCancel, isLateCancel } from '@/lib/booking-history';
import { formatDateTime, formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { BookingCards, BookingTable } from '@/components/club/booking-table';
import { ViewSwitcher, WeekCalendar, useViewPreference, type CalendarEvent, type ViewKind } from '@/components/club/views';
import { mondayOf } from '@/lib/calendar-grid';
import { DateField } from '@/components/club/date-field';
import { PageError } from '@/components/club/page-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const LATE_RULE = 'This session starts within 2 hours, so there is no refund and it still counts toward your daily bookings.';
const FREE_RULE = 'Free to cancel until 2 hours before. After that there is no refund and it still counts toward your daily bookings.';

function CancelDialog({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  const cancel = useCancelBooking();
  const [error, setError] = useState<string | null>(null);
  const late = booking ? isLateCancel(booking) : false;
  function close() {
    if (cancel.isPending) return;
    setError(null);
    onClose();
  }
  async function confirm() {
    if (!booking) return;
    setError(null);
    try {
      const result = await cancel.mutateAsync({ id: booking.id });
      toast.success(result.late ? 'Booking cancelled. No refund applies.' : 'Booking cancelled.');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not cancel this booking. Please try again.');
    }
  }
  return (
    <Dialog open={Boolean(booking)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>{booking ? `${booking.court.name} · ${formatDateTime(booking.startsAt)}` : ''}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{late ? LATE_RULE : FREE_RULE}</p>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" disabled={cancel.isPending} onClick={close}>Keep booking</Button>
          <Button variant="destructive" disabled={cancel.isPending} onClick={() => { void confirm(); }}>{cancel.isPending ? 'Cancelling…' : 'Cancel booking'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Loading() {
  return <div role="status" aria-label="Loading bookings" className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></div>;
}

const VIEWS: ViewKind[] = ['list', 'cards', 'calendar'];
const toEvents = (rows: Booking[], onPick?: (booking: Booking) => void, who = false): CalendarEvent[] => rows.map((b) => {
  const parts: string[] = [];
  if (who) {
    parts.push(b.member?.fullName ?? b.guest?.name ?? 'Walk-in');
  } else if (b.status === 'CANCELLED') {
    parts.push('Cancelled');
  }
  if (b.paymentStatus === 'PARTIAL') {
    const paid = promiseFeePaise(b.pricePaise);
    const due = b.pricePaise - paid;
    parts.push(`Paid ${formatMoney(paid)}, due ${formatMoney(due)}`);
  }
  const subtitle = parts.length > 0 ? parts.join(' · ') : undefined;
  return {
    id: b.id,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    title: b.court.name,
    subtitle,
    tone: b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 'muted' : b.status === 'COMPLETED' ? 'success' : b.paymentStatus === 'PARTIAL' ? 'warning' : 'default',
    onClick: onPick && canCancel(b) ? () => onPick(b) : undefined,
  };
});

function MyBookings({ onCancel }: { onCancel: (booking: Booking) => void }) {
  const [view, setView] = useViewPreference('bookings', VIEWS, 'list');
  const [weekStart, setWeekStart] = useState(calendarDate());
  const [scope, setScope] = useState<BookingScope>('upcoming');
  const query = useMyBookings(scope);
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onValueChange={(value) => setScope(value as BookingScope)}>
          <TabsList aria-label="Booking period"><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList>
        </Tabs>
        <ViewSwitcher views={VIEWS} value={view} onChange={setView} />
      </div>
      {query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} />
        : query.isPending ? <Loading />
        : !rows.length ? <EmptyState title={scope === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}
            description={scope === 'upcoming' ? 'Book a court to see it here.' : 'Finished and cancelled sessions appear here.'}
            action={scope === 'upcoming' ? <Button asChild><Link href="/courts">Book a court</Link></Button> : undefined} />
        : view === 'calendar' ? <WeekCalendar weekStart={weekStart} onWeekChange={setWeekStart} events={toEvents(rows, scope === 'upcoming' ? onCancel : undefined)} />
        : view === 'cards' ? <BookingCards bookings={rows} onCancel={scope === 'upcoming' ? onCancel : undefined} />
        : <BookingTable bookings={rows} onCancel={scope === 'upcoming' ? onCancel : undefined} />}
    </div>
  );
}

function DayBookings({ onCancel }: { onCancel: (booking: Booking) => void }) {
  const today = calendarDate();
  const [date, setDate] = useState(today);
  const [view, setView] = useViewPreference('bookings', VIEWS, 'list');
  const calendar = view === 'calendar';
  const day = useDayBookings(date, !calendar);
  const week = useWeekBookings(mondayOf(date), calendar);
  const query = calendar ? week : day;
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {calendar ? <span /> : <DateField value={date} min={dateAfter(today, -90)} max={dateAfter(today, 30)} onChange={setDate} />}
        <ViewSwitcher views={VIEWS} value={view} onChange={setView} />
      </div>
      {query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} />
        : query.isPending ? <Loading />
        : calendar ? <WeekCalendar weekStart={date} onWeekChange={setDate} events={toEvents(rows, onCancel, true)} emptyLabel="No bookings this week" />
        : !rows.length ? <EmptyState title="No bookings on this date" description="Choose another date to see its bookings." />
        : view === 'cards' ? <BookingCards bookings={rows} showWho onCancel={onCancel} />
        : <BookingTable bookings={rows} showWho onCancel={onCancel} />}
    </div>
  );
}

export default function BookingsPage() {
  const { user, hasPermission } = useAuth();
  const [target, setTarget] = useState<Booking | null>(null);
  if (!user) return null;
  const staff = hasPermission('bookings:read');
  return (
    <div className="space-y-8">
      <PageHeader title={staff ? 'Bookings' : 'My bookings'} description={staff ? 'Every court booking for the chosen date.' : 'Your upcoming and past court sessions.'} />
      {staff ? <DayBookings onCancel={setTarget} /> : <MyBookings onCancel={setTarget} />}
      <CancelDialog booking={target} onClose={() => setTarget(null)} />
    </div>
  );
}
