'use client';

import React from 'react';
import { bookingPayment, type Booking } from '@packages/validation';
import { formatDateTime } from '@/lib/format';
import { canCancel } from '@/lib/booking-history';
import { Money } from '@/components/club/money';
import { formatMoney } from '@/lib/format';
import { StatusBadge } from '@/components/club/status-badge';
import { Button } from '@/components/ui/button';
import { CardGrid } from '@/components/club/views';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** For a part-paid booking, what was paid and what is left to pay at the club. */
export function PaidDue({ booking }: { booking: Booking }) {
  const { paidPaise, duePaise } = bookingPayment(booking);
  if (booking.paymentStatus !== 'PARTIAL') return null;
  return <span className="block text-xs text-muted-foreground">Paid {formatMoney(paidPaise)}, due {formatMoney(duePaise)}</span>;
}

export function BookingTable({ bookings, showWho, onCancel }: { bookings: Booking[]; showWho?: boolean; onCancel?: (booking: Booking) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          {showWho && <TableHead>Booked for</TableHead>}
          <TableHead>Court</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead>Status</TableHead>
          {onCancel && <TableHead><span className="sr-only">Actions</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((booking) => (
          <TableRow key={booking.id}>
            <TableCell className="tabular">{formatDateTime(booking.startsAt)}</TableCell>
            {showWho && <TableCell>{booking.member?.fullName ?? booking.guest?.name ?? 'Walk-in'}</TableCell>}
            <TableCell>{booking.court.name}</TableCell>
            <TableCell className="text-right"><Money paise={booking.pricePaise} /><PaidDue booking={booking} /></TableCell>
            <TableCell><StatusBadge kind="booking" value={booking.status} /></TableCell>
            {onCancel && (
              <TableCell className="text-right">
                {canCancel(booking) && (
                  <Button size="sm" variant="outline" aria-label={`Cancel ${booking.court.name}, ${formatDateTime(booking.startsAt)}`} onClick={() => onCancel(booking)}>Cancel</Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The same bookings as cards, one per booking. */
export function BookingCards({ bookings, showWho, onCancel }: { bookings: Booking[]; showWho?: boolean; onCancel?: (booking: Booking) => void }) {
  return (
    <CardGrid>
      {bookings.map((booking) => (
        <div key={booking.id} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
          <div className="flex items-start justify-between gap-2"><p className="font-medium">{booking.court.name}</p><StatusBadge kind="booking" value={booking.status} /></div>
          <p className="tabular">{formatDateTime(booking.startsAt)}</p>
          {showWho && <p className="text-muted-foreground">{booking.member?.fullName ?? booking.guest?.name ?? 'Walk-in'}</p>}
          <div className="flex items-center justify-between gap-2"><span className="tabular font-medium"><Money paise={booking.pricePaise} /><PaidDue booking={booking} /></span>
            {onCancel && canCancel(booking) && <Button size="sm" variant="outline" onClick={() => onCancel(booking)}>Cancel</Button>}</div>
        </div>
      ))}
    </CardGrid>
  );
}
