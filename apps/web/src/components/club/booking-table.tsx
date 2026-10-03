'use client';

import React from 'react';
import type { Booking } from '@packages/validation';
import { formatDateTime } from '@/lib/format';
import { canCancel } from '@/lib/booking-history';
import { Money } from '@/components/club/money';
import { StatusBadge } from '@/components/club/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
            <TableCell className="text-right"><Money paise={booking.pricePaise} /></TableCell>
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
