import type { Booking } from '@packages/validation';
import { formatMoney } from '@/lib/format';

/** "Paid ₹120, due ₹480" for a booking that has paid part of its price (a cash promise fee); otherwise null. */
export function paymentNote(booking: Pick<Booking, 'paymentStatus' | 'status' | 'pricePaise' | 'paidPaise'>): string | null {
  if (booking.paymentStatus !== 'PARTIAL' || booking.status === 'CANCELLED') return null;
  const due = Math.max(0, booking.pricePaise - booking.paidPaise);
  return `Paid ${formatMoney(booking.paidPaise)}, due ${formatMoney(due)}`;
}
