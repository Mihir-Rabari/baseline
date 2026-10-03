import { describe, expect, it } from 'vitest';
import {
  calculateTimelinePosition,
  findBookingConflict,
  formatTimeRange,
  getTimelineHourSlots,
  getTimelineMinutes,
  isOverlapping,
  resizeBookingDuration,
  shiftBookingTime,
} from './booking-timeline';
import type { BarTableBooking } from '@packages/validation';

describe('Booking Timeline Utilities', () => {
  it('computes timeline minutes relative to start hour (10:00)', () => {
    expect(getTimelineMinutes('2026-10-04T10:00:00.000Z')).toBeDefined();
    // At 12:30 -> 150 minutes past 10:00 (local time)
    const testDate = new Date();
    testDate.setHours(12, 30, 0, 0);
    expect(getTimelineMinutes(testDate.toISOString())).toBe(150);
  });

  it('calculates position percentage correctly for Gantt chart', () => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const end = new Date();
    end.setHours(14, 0, 0, 0);

    const pos = calculateTimelinePosition(start.toISOString(), end.toISOString());
    expect(pos.leftPct).toBeGreaterThan(0);
    expect(pos.widthPct).toBeGreaterThan(0);
    expect(pos.durationMinutes).toBe(120);
  });

  it('accurately identifies overlapping time windows', () => {
    const aStart = new Date('2026-10-04T12:00:00.000Z');
    const aEnd = new Date('2026-10-04T14:00:00.000Z');

    // Overlapping: starts inside
    expect(isOverlapping(aStart, aEnd, new Date('2026-10-04T13:00:00.000Z'), new Date('2026-10-04T15:00:00.000Z'))).toBe(true);
    // Overlapping: completely inside
    expect(isOverlapping(aStart, aEnd, new Date('2026-10-04T12:30:00.000Z'), new Date('2026-10-04T13:30:00.000Z'))).toBe(true);
    // Overlapping: completely engulfing
    expect(isOverlapping(aStart, aEnd, new Date('2026-10-04T11:00:00.000Z'), new Date('2026-10-04T15:00:00.000Z'))).toBe(true);
    // Non-overlapping: strictly before
    expect(isOverlapping(aStart, aEnd, new Date('2026-10-04T10:00:00.000Z'), new Date('2026-10-04T12:00:00.000Z'))).toBe(false);
    // Non-overlapping: strictly after
    expect(isOverlapping(aStart, aEnd, new Date('2026-10-04T14:00:00.000Z'), new Date('2026-10-04T16:00:00.000Z'))).toBe(false);
  });

  it('finds conflicting bookings on the same table and ignores cancelled or excluded bookings', () => {
    const bookings: BarTableBooking[] = [
      {
        id: 'b-1',
        tableId: 't-1',
        tableName: 'T1',
        bookingDate: '2026-10-04',
        startsAt: '2026-10-04T12:00:00.000Z',
        endsAt: '2026-10-04T14:00:00.000Z',
        guestName: 'Karan',
        partySize: 2,
        status: 'CONFIRMED',
      },
      {
        id: 'b-2',
        tableId: 't-1',
        tableName: 'T1',
        bookingDate: '2026-10-04',
        startsAt: '2026-10-04T18:00:00.000Z',
        endsAt: '2026-10-04T20:00:00.000Z',
        guestName: 'Cancelled Guest',
        partySize: 2,
        status: 'CANCELLED',
      },
    ];

    // Conflict with b-1 on t-1
    const conflict = findBookingConflict(bookings, 't-1', '2026-10-04T13:00:00.000Z', '2026-10-04T15:00:00.000Z');
    expect(conflict?.id).toBe('b-1');

    // Self exclusion ignores b-1
    const selfCheck = findBookingConflict(bookings, 't-1', '2026-10-04T13:00:00.000Z', '2026-10-04T15:00:00.000Z', 'b-1');
    expect(selfCheck).toBeNull();

    // Cancelled booking b-2 does not conflict
    const cancelCheck = findBookingConflict(bookings, 't-1', '2026-10-04T18:30:00.000Z', '2026-10-04T19:30:00.000Z');
    expect(cancelCheck).toBeNull();

    // Different table does not conflict
    const diffTable = findBookingConflict(bookings, 't-2', '2026-10-04T13:00:00.000Z', '2026-10-04T15:00:00.000Z');
    expect(diffTable).toBeNull();
  });

  it('shifts and resizes booking duration correctly', () => {
    const originalStart = '2026-10-04T12:00:00.000Z';
    const originalEnd = '2026-10-04T13:30:00.000Z';

    const shifted = shiftBookingTime(originalStart, originalEnd, 30);
    expect(new Date(shifted.startsAt).toISOString()).toBe('2026-10-04T12:30:00.000Z');
    expect(new Date(shifted.endsAt).toISOString()).toBe('2026-10-04T14:00:00.000Z');

    const resized = resizeBookingDuration(originalStart, originalEnd, 30);
    expect(new Date(resized.startsAt).toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(new Date(resized.endsAt).toISOString()).toBe('2026-10-04T14:00:00.000Z');

    expect(formatTimeRange(originalStart, originalEnd)).toMatch(/\d{2}:\d{2} – \d{2}:\d{2}/);
  });

  it('generates hour slots for timeline header', () => {
    const slots = getTimelineHourSlots();
    expect(slots.length).toBe(14); // 10:00 to 23:00 inclusive
    expect(slots[0].label).toBe('10:00');
    expect(slots[slots.length - 1].label).toBe('23:00');
  });
});
