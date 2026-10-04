'use client';

import React from 'react';
import { Printer } from 'lucide-react';
import type { Booking } from '@packages/validation';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';

/** A short reference the guest can quote at the desk. */
export const bookingReference = (id: string) => `BK-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/**
 * The confirmation a guest keeps: what was booked, what was paid and what is still due at the
 * club. It is printable paper, so it renders dark text on white in every theme (`receipt-paper`).
 */
export function BookingReceipt({ booking, paidPaise, duePaise }: { booking: Booking; paidPaise: number; duePaise: number }) {
  const rows: Array<[string, string]> = [
    ['Court', booking.court.name],
    ['When', formatDateTime(booking.startsAt)],
    ['Booked for', booking.guest?.name ?? booking.member?.fullName ?? 'Guest'],
    ['Session price', formatMoney(booking.pricePaise)],
    ['Paid now', formatMoney(paidPaise)],
  ];
  return (
    <div className="space-y-3">
      <div className="receipt-paper space-y-3 rounded-lg border p-4 text-sm" data-testid="booking-receipt">
        <div className="space-y-1 border-b pb-3">
          <h2 className="text-lg font-semibold tracking-tight">Receipt · {bookingReference(booking.id)}</h2>
          <p className="text-xs text-muted-foreground">{duePaise > 0 ? 'Booking held. Balance due at the club.' : 'Booked and paid in full.'}</p>
        </div>
        <dl className="space-y-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="tabular text-right">{value}</dd></div>
          ))}
          <div className="flex justify-between gap-4 border-t pt-2 font-semibold"><dt>{duePaise > 0 ? 'Due at the club' : 'Balance'}</dt><dd className="tabular">{formatMoney(duePaise)}</dd></div>
        </dl>
      </div>
      <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" aria-hidden />Print receipt</Button>
    </div>
  );
}
