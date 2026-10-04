'use client';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreatePublicBookingRequestSchema, type CheckoutMethod } from '@packages/validation';
import { toast } from 'sonner';
import { bookingApi, formatSlotTime } from '@/lib/booking-api';
import { clubToday } from '@/lib/member-form';
import { usePublicAvailability } from '@/hooks/use-public-availability';
import { usePublicClub } from '@/hooks/use-plans';
import { SlotGrid } from '@/components/club/slot-grid';
import type { AvailabilitySlot } from '@packages/validation';
import { DateField } from '@/components/club/date-field';
import { PageError } from '@/components/club/page-error';
import { BookingReceipt } from '@/components/club/booking-receipt';
import { PaymentMethodPicker, checkoutTerms } from '@/components/club/payment-dialog';
import { formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const trialForm = z.object({ name: z.string().trim().min(1, 'Enter your name'), phone: CreatePublicBookingRequestSchema.shape.phone, email: z.string().trim().email().or(z.literal('')) });
export default function PlayPage() {
  const [date, setDate] = useState(clubToday()); const [type, setType] = useState('all'); const [selected, setSelected] = useState<{ courtId: string; slot: AvailabilitySlot } | null>(null); const [method, setMethod] = useState<CheckoutMethod>('UPI');
  const club = usePublicClub(); const client = useQueryClient(); const grid = usePublicAvailability({ date, courtTypeId: type === 'all' ? undefined : type });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof trialForm>>({ resolver: zodResolver(trialForm), defaultValues: { name: '', phone: '', email: '' } });
  const mutation = useMutation({ mutationFn: async (data: z.infer<typeof trialForm>) => { if (!selected) throw new Error('Choose a slot'); return bookingApi.guestBook({ ...data, email: data.email || undefined, courtId: selected.courtId, startsAt: selected.slot.startsAt, method }); }, onSuccess: () => { client.invalidateQueries({ queryKey: ['availability'] }); }, onError: (error) => { toast.error('code' in error && error.code === 'SLOT_TAKEN' ? 'That slot was just taken' : error.message); grid.refetch(); } });
  return <section className="container space-y-6 py-12"><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Find a court</h1><p className="text-muted-foreground">Choose an available time and book it. Pay in full by UPI or card.</p></div>
    <DateField value={date} min={clubToday()} max={new Date(Date.parse(`${clubToday()}T12:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10)} onChange={(value) => { setDate(value); setSelected(null); }} />
    <Tabs value={type} onValueChange={setType}><TabsList className="flex h-auto flex-wrap"><TabsTrigger value="all">All</TabsTrigger>{club.data?.courtTypes.map((court) => <TabsTrigger key={court.id} value={court.id}>{court.name}</TabsTrigger>)}</TabsList></Tabs>
    {grid.isPending ? <Skeleton className="h-96" /> : grid.error ? <PageError error={grid.error} onRetry={() => { grid.refetch(); }} /> : !grid.data?.courts.length ? <EmptyState title="Courts are closed on this day" description="Choose another date." /> : <SlotGrid data={grid.data} selected={selected ? { courtId: selected.courtId, startsAt: selected.slot.startsAt } : null} onSelect={(courtId, slot) => { if (slot.status !== 'FREE') { toast.error('Social sessions are booked through the front desk'); return; } mutation.reset(); reset(); setMethod('UPI'); setSelected({ courtId, slot }); }} />}
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !mutation.isPending) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Book this slot</DialogTitle><DialogDescription>{selected ? `${formatSlotTime(selected.slot.startsAt)}–${formatSlotTime(selected.slot.endsAt)} · ${formatMoney(selected.slot.pricePaise)}` : 'Choose a time.'}</DialogDescription></DialogHeader>{mutation.isSuccess ? <div className="space-y-4"><div role="status" className="space-y-1"><p className="font-medium">{mutation.data.message}</p><p className="text-sm text-muted-foreground">Paid now {formatMoney(mutation.data.paidPaise)}{mutation.data.duePaise > 0 ? ` · Due at the club ${formatMoney(mutation.data.duePaise)}` : ''}</p></div><BookingReceipt booking={mutation.data.booking} paidPaise={mutation.data.paidPaise} duePaise={mutation.data.duePaise} /><Button className="print:hidden" onClick={() => setSelected(null)}>Done</Button></div> : <form noValidate onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4"><fieldset disabled={mutation.isPending} className="space-y-4">{(['name', 'phone', 'email'] as const).map((field) => <div key={field} className="space-y-2"><Label htmlFor={`trial-${field}`}>{field[0].toUpperCase() + field.slice(1)}</Label><Input id={`trial-${field}`} type={field === 'phone' ? 'tel' : field === 'email' ? 'email' : 'text'} autoComplete={field === 'phone' ? 'tel' : field} {...register(field)} aria-invalid={Boolean(errors[field])} />{errors[field] && <p role="alert" className="text-sm text-destructive">{errors[field].message}</p>}</div>)}{selected && <PaymentMethodPicker value={method} onChange={setMethod} totalPaise={selected.slot.pricePaise} cash="promise-fee" allowCash={false} />}<Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Booking…' : selected ? (checkoutTerms(method, selected.slot.pricePaise, 'promise-fee').nowPaise > 0 ? `Pay ${formatMoney(checkoutTerms(method, selected.slot.pricePaise, 'promise-fee').nowPaise)} and book` : 'Book slot') : 'Book slot'}</Button></fieldset></form>}</DialogContent></Dialog>
  </section>;
}
