import { describe, it, expect } from 'vitest';
import {
  addDays,
  clubDate,
  clubDateOf,
  clubParts,
  clubWallTimeToInstant,
  dayRange,
  daysBetween,
  getClubTimezone,
  isInOpeningHours,
  isInSocialWindow,
  isSlotStart,
  isoWeekdayOf,
  monthRange,
  parseTimeOfDay,
  startOfClubDay,
  weekRange,
} from './time.js';

const IST = 'Asia/Kolkata';
const HOURS = { open: '06:00', close: '22:00' };
const FRIDAY_WINDOW = [{ weekday: 5, startsTime: '18:00:00', endsTime: '22:00:00' }];

describe('time helpers (club time zone)', () => {
  it('reads CLUB_TIMEZONE through getEnv()', () => {
    expect(getClubTimezone()).toBe('Asia/Kolkata');
  });

  describe('UTC-midnight boundary', () => {
    it('00:30 IST is still the previous day in UTC but the club date is the IST date', () => {
      const instant = new Date('2026-10-09T19:00:00.000Z'); // 00:30 IST on 10 Oct
      expect(instant.toISOString().slice(0, 10)).toBe('2026-10-09');
      expect(clubDateOf(instant, IST)).toBe('2026-10-10');
      expect(clubDate(instant, IST)).toBe('2026-10-10');
      expect(clubDateOf(instant)).toBe('2026-10-10'); // env default zone
      expect(clubParts(instant, IST)).toMatchObject({ hour: 0, minute: 30, day: 10, weekday: 6 });
    });

    it('23:59 IST belongs to the same club date while 18:30Z is already midnight IST', () => {
      expect(clubDateOf(new Date('2026-10-09T18:29:59.999Z'), IST)).toBe('2026-10-09');
      expect(clubDateOf(new Date('2026-10-09T18:30:00.000Z'), IST)).toBe('2026-10-10');
    });

    it('startOfClubDay returns 18:30Z of the previous UTC day for IST', () => {
      expect(startOfClubDay('2026-10-10', IST).toISOString()).toBe('2026-10-09T18:30:00.000Z');
    });

    it('dayRange is half-open and exactly 24h for a zone without DST', () => {
      const range = dayRange('2026-10-10', IST);
      expect(range.start.toISOString()).toBe('2026-10-09T18:30:00.000Z');
      expect(range.end.toISOString()).toBe('2026-10-10T18:30:00.000Z');
      expect(range.endDateExclusive).toBe('2026-10-11');
    });
  });

  describe('clubWallTimeToInstant', () => {
    it('converts wall times, including minutes beyond midnight', () => {
      expect(clubWallTimeToInstant('2026-10-09', 18 * 60, IST).toISOString()).toBe('2026-10-09T12:30:00.000Z');
      expect(clubWallTimeToInstant('2026-10-09', 24 * 60 + 30, IST).toISOString()).toBe('2026-10-09T19:00:00.000Z');
    });

    it('handles a DST zone on both sides of the change', () => {
      // New York springs forward on 2026-03-08 (02:00 -> 03:00).
      expect(clubWallTimeToInstant('2026-03-07', 12 * 60, 'America/New_York').toISOString()).toBe('2026-03-07T17:00:00.000Z');
      expect(clubWallTimeToInstant('2026-03-09', 12 * 60, 'America/New_York').toISOString()).toBe('2026-03-09T16:00:00.000Z');
      expect(dayRange('2026-03-08', 'America/New_York').end.getTime() - dayRange('2026-03-08', 'America/New_York').start.getTime()).toBe(23 * 3_600_000);
    });

    it('rejects impossible dates', () => {
      expect(() => startOfClubDay('2026-02-30', IST)).toThrow(RangeError);
      expect(() => startOfClubDay('10/10/2026', IST)).toThrow(RangeError);
    });
  });

  describe('calendar arithmetic', () => {
    it('adds days across month and year ends', () => {
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('counts days between dates', () => {
      expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
      expect(daysBetween('2026-10-12', '2026-10-09')).toBe(-3);
      expect(daysBetween('2026-10-09', '2026-10-09')).toBe(0);
    });

    it.each([
      ['2026-10-09', 5], // Friday
      ['2026-10-11', 7], // Sunday is 7, not 0
      ['2026-10-12', 1], // Monday
    ])('isoWeekdayOf(%s) = %i', (date, weekday) => {
      expect(isoWeekdayOf(date)).toBe(weekday);
    });

    it('parses HH:MM and HH:MM:SS', () => {
      expect(parseTimeOfDay('06:00')).toBe(360);
      expect(parseTimeOfDay('18:00:00')).toBe(1080);
      expect(() => parseTimeOfDay('25:00')).toThrow(RangeError);
      expect(() => parseTimeOfDay('nope')).toThrow(RangeError);
    });
  });

  describe('week and month ranges', () => {
    it('weekRange runs Monday to the next Monday in club time', () => {
      const range = weekRange('2026-10-09', IST); // Friday
      expect(range.startDate).toBe('2026-10-05');
      expect(range.endDateExclusive).toBe('2026-10-12');
      expect(range.start.toISOString()).toBe('2026-10-04T18:30:00.000Z');
      expect(range.end.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    });

    it('weekRange of a Sunday still starts on the preceding Monday', () => {
      expect(weekRange('2026-10-11', IST).startDate).toBe('2026-10-05');
    });

    it('monthRange spans the whole club month, including December rollover', () => {
      const october = monthRange('2026-10-17', IST);
      expect(october.startDate).toBe('2026-10-01');
      expect(october.endDateExclusive).toBe('2026-11-01');
      expect(october.start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
      expect(monthRange('2026-12-31', IST).endDateExclusive).toBe('2027-01-01');
    });

    it('an instant just after IST midnight on the 1st belongs to the new month, not the UTC month', () => {
      const instant = new Date('2026-09-30T18:45:00.000Z'); // 00:15 IST on 1 Oct
      const range = monthRange(clubDateOf(instant, IST), IST);
      expect(range.startDate).toBe('2026-10-01');
      expect(instant >= range.start && instant < range.end).toBe(true);
    });
  });

  describe('isSlotStart (BR-02)', () => {
    it.each([
      ['2026-10-09T12:30:00.000Z', true], // 18:00 IST
      ['2026-10-09T13:00:00.000Z', true], // 18:30 IST
      ['2026-10-09T12:45:00.000Z', false], // 18:15 IST
      ['2026-10-09T12:30:30.000Z', false], // seconds
      ['2026-10-09T12:30:00.001Z', false], // millis
    ])('%s -> %s', (iso, expected) => {
      expect(isSlotStart(new Date(iso), IST)).toBe(expected);
    });

    it('is evaluated in club time, not UTC (a half-hour offset zone)', () => {
      // 12:00Z is 17:30 IST: a slot start in IST, but not in UTC+05:45 (Kathmandu, 17:45).
      expect(isSlotStart(new Date('2026-10-09T12:00:00.000Z'), IST)).toBe(true);
      expect(isSlotStart(new Date('2026-10-09T12:00:00.000Z'), 'Asia/Kathmandu')).toBe(false);
    });

    it('rejects invalid dates', () => {
      expect(isSlotStart(new Date('nope'), IST)).toBe(false);
    });
  });

  describe('isInOpeningHours (BR-01)', () => {
    it.each([
      ['2026-10-09T00:30:00.000Z', true], // 06:00 IST, opening time
      ['2026-10-09T00:00:00.000Z', false], // 05:30 IST
      ['2026-10-09T10:30:00.000Z', true], // 16:00 IST
      ['2026-10-09T15:30:00.000Z', true], // 21:00 IST, last start
      ['2026-10-09T16:00:00.000Z', false], // 21:30 IST would end 22:30
      ['2026-10-09T16:30:00.000Z', false], // 22:00 IST
      ['2026-10-09T19:00:00.000Z', false], // 00:30 IST next day
    ])('%s -> %s', (iso, expected) => {
      expect(isInOpeningHours(new Date(iso), HOURS, IST)).toBe(expected);
    });

    it('honours custom hours read from settings', () => {
      expect(isInOpeningHours(new Date('2026-10-09T19:00:00.000Z'), { open: '00:00', close: '02:00' }, IST)).toBe(true);
    });
  });

  describe('isInSocialWindow (BR-10)', () => {
    it.each([
      ['2026-10-09T12:30:00.000Z', true], // Friday 18:00 IST
      ['2026-10-09T15:30:00.000Z', true], // Friday 21:00 IST, ends 22:00
      ['2026-10-09T13:00:00.000Z', true], // 18:30 IST, still inside the window (alignment is a separate rule)
      ['2026-10-09T16:00:00.000Z', false], // 21:30 would end 22:30
      ['2026-10-09T12:00:00.000Z', false], // 17:30 starts before the window
      ['2026-10-10T12:30:00.000Z', false], // Saturday 18:00
    ])('%s -> %s', (iso, expected) => {
      expect(isInSocialWindow(new Date(iso), FRIDAY_WINDOW, IST)).toBe(expected);
    });

    it('uses the club weekday, not the UTC weekday (Friday 00:30 IST is Thursday in UTC)', () => {
      const window = [{ weekday: 5, startsTime: '00:00', endsTime: '02:00' }];
      expect(isInSocialWindow(new Date('2026-10-08T19:00:00.000Z'), window, IST)).toBe(true);
    });
  });
});
