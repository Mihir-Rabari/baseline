import { describe, expect, it } from 'vitest';
import type { TableBooking } from '@packages/validation';
import { applyDrag, clubInstant, clubTimeInput, findConflict, minutesOfDay, percentAt, snap, timelineRange } from '../../../../apps/web/src/lib/table-bookings';

const DATE = '2030-03-10';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const at = (hhmm: string) => clubInstant(DATE, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
const make = (id: string, tableId: string, from: string, to: string, status: TableBooking['status'] = 'BOOKED'): TableBooking => ({
  id, tableId, tableName: 'T', guestName: 'G', memberId: null, partySize: 2, notes: null, status,
  startsAt: new Date(at(from)).toISOString(), endsAt: new Date(at(to)).toISOString(),
});

describe('club time helpers', () => {
  it('maps club wall time to instants and back (Asia/Kolkata is UTC+5:30)', () => {
    expect(new Date(clubInstant(DATE, 0)).toISOString()).toBe('2030-03-09T18:30:00.000Z');
    expect(minutesOfDay(clubInstant(DATE, 18 * 60 + 30), DATE)).toBe(18 * 60 + 30);
    expect(clubTimeInput(clubInstant(DATE, 7 * 60 + 5))).toBe('07:05');
    expect(minutesOfDay(clubInstant(DATE, 25 * 60), DATE)).toBe(25 * 60); // past midnight belongs to the same grid
  });

  it('snaps to 15 minutes', () => {
    expect(snap(at('10:07'))).toBe(at('10:00'));
    expect(snap(at('10:08'))).toBe(at('10:15'));
  });
});

describe('timelineRange', () => {
  it('defaults to 8:00 to midnight and widens to fit early and late bookings', () => {
    expect(timelineRange(DATE, [])).toMatchObject({ startHour: 8, endHour: 24 });
    expect(timelineRange(DATE, [make('a', T1, '06:30', '08:00')]).startHour).toBe(6);
    expect(timelineRange(DATE, [{ startsAt: new Date(at('23:00')).toISOString(), endsAt: new Date(clubInstant(DATE, 25 * 60 + 10)).toISOString() }]).endHour).toBe(26);
  });

  it('positions instants as a percentage of the window', () => {
    const range = timelineRange(DATE, []);
    expect(percentAt(at('08:00'), range)).toBe(0);
    expect(percentAt(at('16:00'), range)).toBe(50);
    expect(percentAt(clubInstant(DATE, 24 * 60), range)).toBe(100);
  });
});

describe('findConflict', () => {
  const list = [make('a', T1, '10:00', '12:00'), make('b', T2, '10:00', '12:00'), make('c', T1, '14:00', '15:00', 'CANCELLED'), make('d', T1, '16:00', '17:00', 'COMPLETED')];
  const cand = (tableId: string, from: string, to: string, id?: string) => ({ id, tableId, startMs: at(from), endMs: at(to) });

  it('finds overlaps on the same table only', () => {
    expect(findConflict(list, cand(T1, '11:00', '13:00'))?.id).toBe('a');
    expect(findConflict(list, cand(T1, '09:00', '10:30'))?.id).toBe('a');
    expect(findConflict(list, cand(T1, '10:30', '11:00'))?.id).toBe('a');
    expect(findConflict(list, cand(T2, '09:00', '10:30'))?.id).toBe('b');
  });

  it('treats touching edges, other tables, closed bookings and the booking itself as free', () => {
    expect(findConflict(list, cand(T1, '12:00', '13:00'))).toBeUndefined();
    expect(findConflict(list, cand(T1, '09:00', '10:00'))).toBeUndefined();
    expect(findConflict(list, cand(T1, '14:00', '15:00'))).toBeUndefined(); // cancelled
    expect(findConflict(list, cand(T1, '16:00', '17:00'))).toBeUndefined(); // completed
    expect(findConflict(list, cand(T1, '10:15', '11:45', 'a'))).toBeUndefined(); // itself
  });
});

describe('applyDrag', () => {
  const origin = { tableId: T1, startMs: at('10:00'), endMs: at('11:00') };
  const min = (n: number) => n * 60_000;

  it('moves in 15 minute steps, keeping the length and allowing a table change', () => {
    expect(applyDrag(origin, 'move', min(38), T2)).toEqual({ tableId: T2, startMs: at('10:45'), endMs: at('11:45') });
    expect(applyDrag(origin, 'move', min(-20), T1)).toEqual({ tableId: T1, startMs: at('09:45'), endMs: at('10:45') });
  });

  it('resizes only the end, never below one step or above 12 hours', () => {
    expect(applyDrag(origin, 'resize', min(60), T2)).toEqual({ tableId: T1, startMs: at('10:00'), endMs: at('12:00') });
    expect(applyDrag(origin, 'resize', min(-600), T1).endMs).toBe(at('10:15'));
    expect(applyDrag(origin, 'resize', min(60 * 20), T1).endMs).toBe(at('22:00'));
  });
});

describe('percentAt precision', () => {
  it('never returns NaN for a zero-length window input', () => {
    const range = timelineRange(DATE, []);
    expect(Number.isFinite(percentAt(at('09:00'), range))).toBe(true);
  });
});
