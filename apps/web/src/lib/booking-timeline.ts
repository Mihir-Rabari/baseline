import type { BarTableBooking } from '@packages/validation';

export const TIMELINE_START_HOUR = 10; // 10:00 AM
export const TIMELINE_END_HOUR = 23; // 11:00 PM
export const TIMELINE_TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60; // 780 minutes

export interface TimelinePosition {
  leftPct: number;
  widthPct: number;
  startMinutes: number;
  durationMinutes: number;
}

/** Converts an ISO date-time string to minutes from start of timeline day (relative to TIMELINE_START_HOUR). */
export function getTimelineMinutes(isoString: string): number {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const startDayMinutes = TIMELINE_START_HOUR * 60;
  return totalMinutes - startDayMinutes;
}

/** Calculates position percentage (left, width) for Gantt chart rendering. */
export function calculateTimelinePosition(startsAt: string, endsAt: string): TimelinePosition {
  const startMins = getTimelineMinutes(startsAt);
  const endMins = getTimelineMinutes(endsAt);
  const clampedStart = Math.max(0, Math.min(TIMELINE_TOTAL_MINUTES, startMins));
  const clampedEnd = Math.max(clampedStart + 15, Math.min(TIMELINE_TOTAL_MINUTES, endMins));
  const duration = Math.max(15, clampedEnd - clampedStart);

  const leftPct = (clampedStart / TIMELINE_TOTAL_MINUTES) * 100;
  const widthPct = Math.max(1.5, (duration / TIMELINE_TOTAL_MINUTES) * 100);

  return {
    leftPct: Math.max(0, Math.min(100, leftPct)),
    widthPct: Math.max(1.5, Math.min(100 - leftPct, widthPct)),
    startMinutes: clampedStart,
    durationMinutes: duration,
  };
}

/** Check if two time intervals overlap. */
export function isOverlapping(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

/** Finds any conflicting booking for a given table and time range. */
export function findBookingConflict(
  bookings: BarTableBooking[],
  tableId: string,
  startsAt: string,
  endsAt: string,
  excludeBookingId?: string
): BarTableBooking | null {
  const targetStart = new Date(startsAt);
  const targetEnd = new Date(endsAt);

  for (const b of bookings) {
    if (b.status === 'CANCELLED' || b.tableId !== tableId || (excludeBookingId && b.id === excludeBookingId)) {
      continue;
    }
    const bStart = new Date(b.startsAt);
    const bEnd = new Date(b.endsAt);
    if (isOverlapping(targetStart, targetEnd, bStart, bEnd)) {
      return b;
    }
  }
  return null;
}

/** Adjust booking time by delta minutes (for move or resize). */
export function shiftBookingTime(
  startsAt: string,
  endsAt: string,
  deltaMinutes: number
): { startsAt: string; endsAt: string } {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  start.setMinutes(start.getMinutes() + deltaMinutes);
  end.setMinutes(end.getMinutes() + deltaMinutes);
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

/** Extend or shrink duration by delta minutes (keeping startsAt fixed). */
export function resizeBookingDuration(
  startsAt: string,
  endsAt: string,
  deltaMinutes: number
): { startsAt: string; endsAt: string } {
  const end = new Date(endsAt);
  end.setMinutes(end.getMinutes() + deltaMinutes);
  const start = new Date(startsAt);
  // Guarantee minimum 15 minutes duration
  if (end.getTime() - start.getTime() < 15 * 60 * 1000) {
    end.setTime(start.getTime() + 15 * 60 * 1000);
  }
  return {
    startsAt,
    endsAt: end.toISOString(),
  };
}

/** Formats a time range e.g. "12:30 – 14:00". */
export function formatTimeRange(startsAt: string, endsAt: string): string {
  const format = (iso: string) => {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };
  return `${format(startsAt)} – ${format(endsAt)}`;
}

/** Generates hour markers for Gantt grid header. */
export function getTimelineHourSlots(): { hour: number; label: string; leftPct: number }[] {
  const slots: { hour: number; label: string; leftPct: number }[] = [];
  for (let hour = TIMELINE_START_HOUR; hour <= TIMELINE_END_HOUR; hour++) {
    const mins = (hour - TIMELINE_START_HOUR) * 60;
    const leftPct = (mins / TIMELINE_TOTAL_MINUTES) * 100;
    const formatted = `${String(hour).padStart(2, '0')}:00`;
    slots.push({ hour, label: formatted, leftPct });
  }
  return slots;
}
