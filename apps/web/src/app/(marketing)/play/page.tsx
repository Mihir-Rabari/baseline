'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { Booking } from '@packages/validation';
import { usePublicAvailability, useTrialBooking } from '@/hooks/use-public-play';
import { ApiError } from '@/lib/api-client';
import { calendarDate, dateAfter, slotTime, type SlotSelection } from '@/lib/booking-calendar';
import { TrialFormSchema, type TrialDetails, type TrialFormValues } from '@/lib/trial-form';
import { EmptyState } from '@/components/app-shell/empty-state';
import { DateField } from '@/components/club/date-field';
import { PageError } from '@/components/club/page-error';
import { SlotGrid } from '@/components/club/slot-grid';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const sports = { ALL: 'All courts', TENNIS: 'Tennis', PADEL: 'Padel', BADMINTON: 'Badminton', CRICKET_NETS: 'Cricket nets' };
const TRIAL_MESSAGE = 'Trial booked. Pay at the club on arrival.';

function TrialDialog({ selection, courtName, timezone, onClose, onTaken }: {
  selection: SlotSelection | null; courtName: string; timezone: string; onClose: () => void; onTaken: () => void;
}) {
  const trial = useTrialBooking();
  const [booked, setBooked] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setError: setFieldError, formState: { errors } } = useForm<TrialFormValues, unknown, TrialDetails>({
    resolver: zodResolver(TrialFormSchema), defaultValues: { name: '', phone: '', email: '' },
  });
  const open = Boolean(selection) || Boolean(booked);
  function close() {
    if (trial.isPending) return;
    setBooked(null); setError(null); trial.reset(); onClose();
  }
  async function submit(details: TrialDetails) {
    if (!selection) return;
    setError(null);
    try {
      const result = await trial.mutateAsync({ ...selection, ...details });
      setBooked(result.booking);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'SLOT_TAKEN') {
        toast.error('That slot was just taken. Choose another time.');
        setBooked(null); onTaken();
      } else if (caught instanceof ApiError && caught.code === 'TRIAL_ALREADY_USED') {
        setFieldError('phone', { message: 'This phone number has already used a free trial.' });
      } else {
        setError(caught instanceof Error ? caught.message : 'We could not book your trial. Please try again.');
      }
    }
  }
  const startsAt = booked?.startsAt ?? selection?.startsAt;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent>
        {booked ? <>
          <DialogHeader>
            <DialogTitle>Trial booked</DialogTitle>
            <DialogDescription>{booked.court.name} · {slotTime(booked.startsAt, timezone)}</DialogDescription>
          </DialogHeader>
          <p role="status" className="text-sm">{TRIAL_MESSAGE}</p>
          <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
        </> : <>
          <DialogHeader>
            <DialogTitle>Book a trial</DialogTitle>
            <DialogDescription>{courtName}{startsAt ? ` · ${slotTime(startsAt, timezone)}` : ''}. Pay at the club on arrival.</DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={(event) => { void handleSubmit(submit)(event); }} className="space-y-4">
            <fieldset disabled={trial.isPending} className="space-y-4">
              {(['name', 'phone', 'email'] as const).map((field) => (
                <div className="space-y-2" key={field}>
                  <Label htmlFor={`trial-${field}`}>{field === 'name' ? 'Name' : field === 'phone' ? 'Phone' : 'Email (optional)'}</Label>
                  <Input id={`trial-${field}`} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} autoComplete={field === 'phone' ? 'tel' : field}
                    aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `trial-${field}-error` : undefined} {...register(field)} />
                  {errors[field] && <p id={`trial-${field}-error`} role="alert" className="text-sm text-destructive">{errors[field].message}</p>}
                </div>
              ))}
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit">{trial.isPending ? 'Booking…' : 'Book trial'}</Button>
              </DialogFooter>
            </fieldset>
          </form>
        </>}
      </DialogContent>
    </Dialog>
  );
}

export default function PlayPage() {
  const [date, setDate] = useState(calendarDate());
  const [sport, setSport] = useState('ALL');
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const availability = usePublicAvailability({ date });
  const data = availability.data;
  const timezone = data?.timezone ?? 'Asia/Kolkata';
  const today = calendarDate(new Date(), timezone);
  const visible = data ? { ...data, courts: data.courts.filter((court) => sport === 'ALL' || court.type === sport) } : null;
  const court = data?.courts.find((item) => item.courtId === selection?.courtId);

  return (
    <section className="container space-y-6 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Play at the club</h1>
        <p className="text-muted-foreground">See which courts are free over the next week and book a trial session.</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <DateField value={date} min={today} max={dateAfter(today, 6)} onChange={(value) => { setDate(value); setSelection(null); }} />
        <p className="text-xs text-muted-foreground">Club time · {timezone} · Updates every 10 seconds</p>
      </div>
      <Tabs value={sport} onValueChange={(value) => { setSport(value); setSelection(null); }}>
        <TabsList className="flex h-auto flex-wrap justify-start" aria-label="Sport">
          {Object.entries(sports).map(([code, label]) => <TabsTrigger key={code} value={code}>{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {availability.error ? <PageError error={availability.error} onRetry={() => { void availability.refetch(); }} />
        : availability.isPending ? <div role="status" aria-label="Loading court availability" className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>
        : !visible?.courts.some((item) => item.slots.length) ? <EmptyState title="Courts are closed on this day" description="Try another date or sport." />
        : <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Choose a free time to book a trial. Shared social sessions are joined at the club.</p>
          <SlotGrid data={visible} selected={selection} canSelect={(slot) => slot.status === 'FREE'}
            onSelect={(courtId, slot) => setSelection({ courtId, startsAt: slot.startsAt })} />
        </div>}
      <TrialDialog key={`${selection?.courtId}-${selection?.startsAt}`} selection={selection} courtName={court?.name ?? 'Court'} timezone={timezone}
        onClose={() => setSelection(null)} onTaken={() => { setSelection(null); void availability.refetch(); }} />
    </section>
  );
}
