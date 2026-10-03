import type { Booking } from '@packages/validation';

export const CANCEL_CUTOFF_MS = 2 * 60 * 60 * 1000;

export const canCancel = (booking: Booking, now = Date.now()) => booking.status === 'CONFIRMED' && Date.parse(booking.startsAt) > now;
/** True when cancelling now falls inside the cutoff: no refund and the daily quota is kept. */
export const isLateCancel = (booking: Booking, now = Date.now()) => Date.parse(booking.startsAt) - now < CANCEL_CUTOFF_MS;
