'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { MemberLookupItem } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useAvailability, useCreateBooking } from '@/hooks/use-availability';
import { ApiError } from '@/lib/api-client';
import { bookingPayload, calendarDate, dateAfter, canSelectSlot, slotTime, type SlotSelection } from '@/lib/booking-calendar';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { SlotGrid } from '@/components/club/slot-grid';
import { DateField } from '@/components/club/date-field';
import { MemberSearch } from '@/components/club/member-search';
import { Money } from '@/components/club/money';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectBox } from '@/components/club/ops-bits';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const sports = { ALL: 'All courts', TENNIS: 'Tennis', PADEL: 'Padel', BADMINTON: 'Badminton', CRICKET_NETS: 'Cricket nets' };
export default function CourtsPage() {
  const { user, hasPermission } = useAuth();
  const staff = hasPermission('bookings:create');
  const canRead = hasPermission('bookings:read') || hasPermission('bookings:read:self');
  const canBook = staff || hasPermission('bookings:create:self');
  const [date, setDate] = useState(calendarDate());
  const [sport, setSport] = useState('ALL');
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const [mode, setMode] = useState<'MEMBER' | 'GUEST'>('GUEST');
  const [member, setMember] = useState<MemberLookupItem | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState('LATER');
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability({ date, ...(staff && mode === 'MEMBER' && member ? { memberId: member.id } : {}) }, Boolean(user) && canRead);
  const create = useCreateBooking();
  const data = availability.data;
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  const today = calendarDate(new Date(), timezone);
  const court = data?.courts.find((item) => item.courtId === selection?.courtId);
  const slot = court?.slots.find((item) => item.startsAt === selection?.startsAt);
  const validSelection = slot && canSelectSlot(slot) && (sport === 'ALL' || court?.type === sport);
  const quotaUsed = data?.limits && data.limits.usedToday >= data.limits.maxPerDay;
  const social = slot?.status === 'SOCIAL_OPEN';
  const visible = data ? { ...data, courts: data.courts.filter((item) => sport === 'ALL' || item.type === sport) } : null;
  function resetSelection() { setSelection(null); setError(null); create.reset(); }
  if (!user) return null;

  async function book() {
    if (!selection || !validSelection || !canBook || create.isPending || availability.isFetching || quotaUsed) return;
    setError(null);
    try {
      const payload = bookingPayload(selection, staff, { mode, memberId: member?.id, name, phone, payment }, Boolean(social));
      const booking = await create.mutateAsync({ social: Boolean(social), data: payload });
      toast.success(`${social ? 'Joined' : 'Booked'} ${booking.court.name} at ${slotTime(booking.startsAt, timezone)}`);
      setSelection(null);
    } catch (caught) {
      if (caught instanceof ApiError && ['SLOT_TAKEN', 'SOCIAL_FULL', 'SOCIAL_WINDOW'].includes(caught.code)) {
        toast.error(caught.code === 'SLOT_TAKEN' ? 'That slot was just taken. Choose another time.' : caught.message);
        setSelection(null); void availability.refetch();
      } else if (caught instanceof Error) {
        const message = 'issues' in caught ? 'Check the guest name and phone number before booking.' : caught.message;
        setError(message);
      }
    }
  }

  return <div className="space-y-8">
    <PageHeader title="Courts" description="Choose a court and time. Prices include the selected member’s benefits." />
    {!canRead ? <EmptyState title="Court booking is unavailable" description="Ask the front desk to help with a booking." /> : <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <DateField value={date} min={today} max={dateAfter(today, 14)} disabled={create.isPending} onChange={(value) => { setDate(value); resetSelection(); }} />
        <p className="text-xs text-muted-foreground">Club time · {timezone} · Updates every 10 seconds</p>
      </div>
      {staff && <fieldset disabled={create.isPending} className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
        <SelectBox id="booking-for" label="Booking for" value={mode} onChange={(value) => { setMode(value as 'MEMBER' | 'GUEST'); resetSelection(); }} options={[{ value: 'GUEST', label: 'Walk-in' }, { value: 'MEMBER', label: 'Member' }]} />
        {mode === 'MEMBER' ? <MemberSearch value={member} disabled={create.isPending} onChange={(value) => { setMember(value); resetSelection(); }} />
          : <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="guest-name">Guest name</Label><Input id="guest-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="guest-phone">Guest phone</Label><Input id="guest-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></div></div>}
      </fieldset>}
      <Tabs value={sport} onValueChange={(value) => { setSport(value); resetSelection(); }}>
        <TabsList className="flex h-auto flex-wrap justify-start" aria-label="Sport">{Object.entries(sports).map(([code, label]) => <TabsTrigger key={code} value={code} disabled={create.isPending}>{label}</TabsTrigger>)}</TabsList>
      </Tabs>
      {(error || quotaUsed) && <Alert variant="destructive"><AlertDescription>{error ?? `Daily booking limit reached (${data?.limits?.usedToday} of ${data?.limits?.maxPerDay}). Choose another day.`}</AlertDescription></Alert>}
      {availability.error ? <PageError error={availability.error} onRetry={() => { void availability.refetch(); }} />
        : availability.isPending ? <div role="status" aria-label="Loading court availability" className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>
        : !visible?.courts.some((item) => item.slots.length) ? <EmptyState title="No court sessions available" description="Try another date or sport." />
        : <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-3"><p className="text-sm text-muted-foreground">Prices for {data?.priceFor.label}. Free cells show the full session price; social cells show places left.</p>
            <SlotGrid data={visible} selected={validSelection ? selection : null} disabled={!canBook || create.isPending || Boolean(quotaUsed)}
              onSelect={(courtId, chosen) => { setSelection({ courtId, startsAt: chosen.startsAt }); setError(null); }} />
          </div>
          <section className="space-y-4 rounded-lg border p-5" aria-label="Booking summary">
            <h2 className="text-lg font-semibold">Your session</h2>
            {validSelection && slot && court ? <>
              <dl className="divide-y text-sm"><div className="py-3"><dt className="text-muted-foreground">Court</dt><dd className="mt-1 font-medium">{court.name}</dd></div>
                <div className="py-3"><dt className="text-muted-foreground">Time</dt><dd className="mt-1 tabular">{slotTime(slot.startsAt, timezone)} – {slotTime(slot.endsAt, timezone)}</dd></div>
                <div className="flex justify-between py-3"><dt className="text-muted-foreground">Total</dt><dd className="font-medium"><Money paise={slot.pricePaise} /></dd></div></dl>
              {data?.limits && <p className="text-sm text-muted-foreground">Used {data.limits.usedToday} of {data.limits.maxPerDay} bookings on this date.</p>}
              {staff && !social && <SelectBox id="booking-payment" label="Payment" value={payment} disabled={create.isPending} onChange={setPayment} options={[{ value: 'LATER', label: 'Pay at the club' }, { value: 'CASH', label: 'Cash now' }, { value: 'CARD', label: 'Card now' }, { value: 'UPI', label: 'UPI now' }]} />}
              {social && <p className="text-sm text-muted-foreground">Shared session · {slot.spotsLeft} places left. Pay at the club.</p>}
              <Button className="w-full" onClick={() => { void book(); }} disabled={create.isPending || availability.isFetching || Boolean(quotaUsed) || (staff && mode === 'MEMBER' && !member)}>{create.isPending ? 'Confirming…' : social ? 'Join session' : 'Book court'}</Button>
              <Button variant="ghost" className="w-full" disabled={create.isPending} onClick={resetSelection}>Change selection</Button>
            </> : <p className="text-sm text-muted-foreground">{selection ? 'That session is no longer available. Choose another time.' : 'Select an available time to see the session and confirm your booking.'}</p>}
          </section>
        </div>}
    </>}
  </div>;
}
