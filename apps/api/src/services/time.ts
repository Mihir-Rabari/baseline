import { getEnv } from '@packages/config/env';

/**
 * Club-time helpers.
 *
 * Every business date and opening hour in CourtOS is expressed in the club's IANA time zone
 * (`CLUB_TIMEZONE`, default `Asia/Kolkata`), while every stored instant is UTC. These helpers
 * are the single bridge between the two, built on `Intl.DateTimeFormat` so no date library is
 * needed. Pass `timeZone` explicitly in tests; production code relies on the env default.
 *
 * Note that 00:30 IST on 2026-10-10 is 19:00 UTC on 2026-10-09: never derive a business date
 * with `toISOString().slice(0, 10)`.
 */

export const MINUTES_PER_DAY = 24 * 60;
export const SESSION_MINUTES = 60;
export const SLOT_STEP_MINUTES = 30;

export interface ClubParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday ... 7 = Sunday (Friday = 5), matching `social_windows.weekday`. */
  weekday: number;
}

export interface TimeRange {
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant. */
  end: Date;
  /** First club date in the range (`YYYY-MM-DD`). */
  startDate: string;
  /** Club date of the first day AFTER the range (`YYYY-MM-DD`, exclusive). */
  endDateExclusive: string;
}

export interface OpeningHours {
  open: string; // 'HH:MM'
  close: string; // 'HH:MM'
}

export interface SocialWindow {
  weekday: number; // ISO 1..7
  startsTime: string; // 'HH:MM' or 'HH:MM:SS' (Postgres `time`)
  endsTime: string;
}

export function getClubTimezone(): string {
  return getEnv().CLUB_TIMEZONE;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(date);
  if (!match) {
    throw new RangeError(`Invalid club date "${date}", expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`Invalid club date "${date}": not a real calendar date`);
  }
  return { year, month, day };
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Wall-clock parts of `instant` in the club zone. */
export function clubParts(instant: Date, timeZone: string = getClubTimezone()): ClubParts {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Invalid instant');
  }
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const weekdayIndex = new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay();
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    weekday: weekdayIndex === 0 ? 7 : weekdayIndex,
  };
}

/** Club-local business date (`YYYY-MM-DD`) of an instant. */
export function clubDateOf(instant: Date, timeZone: string = getClubTimezone()): string {
  const parts = clubParts(instant, timeZone);
  return formatDate(parts.year, parts.month, parts.day);
}

/** Alias of {@link clubDateOf}. */
export function clubDate(instant: Date, timeZone: string = getClubTimezone()): string {
  return clubDateOf(instant, timeZone);
}

/** Club-local minutes since midnight (0..1439) of an instant. */
export function clubMinutesOfDay(instant: Date, timeZone: string = getClubTimezone()): number {
  const parts = clubParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** Adds (or subtracts) calendar days to a `YYYY-MM-DD` date. Zone independent. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function isoWeekdayOf(date: string): number {
  const { year, month, day } = parseDate(date);
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return index === 0 ? 7 : index;
}

/** Parses `HH:MM` or `HH:MM:SS` to minutes since midnight. */
export function parseTimeOfDay(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) {
    throw new RangeError(`Invalid time of day "${value}", expected HH:MM`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    throw new RangeError(`Invalid time of day "${value}"`);
  }
  return hours * 60 + minutes;
}

/**
 * The UTC instant at which the club wall clock reads `date` + `minutesOfDay`.
 * `minutesOfDay` may exceed 1439 to address the following day.
 */
export function clubWallTimeToInstant(
  date: string,
  minutesOfDay: number,
  timeZone: string = getClubTimezone()
): Date {
  const { year, month, day } = parseDate(date);
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minutesOfDay);

  // Offset of the zone at a given instant: wall clock read as UTC minus the real instant.
  const offsetAt = (utcMs: number): number => {
    const whole = Math.floor(utcMs / 1000) * 1000;
    const p = clubParts(new Date(whole), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
  };

  // Two passes settle the offset even when the guess lands on the other side of a DST change.
  const first = wallAsUtc - offsetAt(wallAsUtc);
  return new Date(wallAsUtc - offsetAt(first));
}

/** The instant of 00:00 club time on `date`. */
export function startOfClubDay(date: string, timeZone: string = getClubTimezone()): Date {
  return clubWallTimeToInstant(date, 0, timeZone);
}

/** Half-open range covering one club day. */
export function dayRange(date: string, timeZone: string = getClubTimezone()): TimeRange {
  const endDateExclusive = addDays(date, 1);
  return {
    start: startOfClubDay(date, timeZone),
    end: startOfClubDay(endDateExclusive, timeZone),
    startDate: date,
    endDateExclusive,
  };
}

/** Half-open range covering the ISO week (Monday to Sunday) that contains `date`, in club time. */
export function weekRange(date: string, timeZone: string = getClubTimezone()): TimeRange {
  const startDate = addDays(date, 1 - isoWeekdayOf(date));
  const endDateExclusive = addDays(startDate, 7);
  return {
    start: startOfClubDay(startDate, timeZone),
    end: startOfClubDay(endDateExclusive, timeZone),
    startDate,
    endDateExclusive,
  };
}

/** Half-open range covering the calendar month that contains `date`, in club time. */
export function monthRange(date: string, timeZone: string = getClubTimezone()): TimeRange {
  const { year, month } = parseDate(date);
  const startDate = formatDate(year, month, 1);
  const endDateExclusive = month === 12 ? formatDate(year + 1, 1, 1) : formatDate(year, month + 1, 1);
  return {
    start: startOfClubDay(startDate, timeZone),
    end: startOfClubDay(endDateExclusive, timeZone),
    startDate,
    endDateExclusive,
  };
}

/** BR-02: starts only on :00 or :30 club time (whole seconds and milliseconds). */
export function isSlotStart(instant: Date, timeZone: string = getClubTimezone()): boolean {
  if (Number.isNaN(instant.getTime())) return false;
  if (instant.getUTCSeconds() !== 0 || instant.getUTCMilliseconds() !== 0) return false;
  return clubParts(instant, timeZone).minute % SLOT_STEP_MINUTES === 0;
}

/**
 * BR-01: a session starting at `instant` lies inside opening hours when it starts at or after
 * opening and ends by closing (so the last start is closing minus the session length).
 */
export function isInOpeningHours(
  instant: Date,
  hours: OpeningHours,
  timeZone: string = getClubTimezone(),
  durationMinutes: number = SESSION_MINUTES
): boolean {
  const start = clubMinutesOfDay(instant, timeZone);
  return start >= parseTimeOfDay(hours.open) && start + durationMinutes <= parseTimeOfDay(hours.close);
}

/**
 * BR-10: true when a session of `durationMinutes` starting at `instant` lies entirely inside one
 * of the social windows for that club weekday.
 */
export function isInSocialWindow(
  instant: Date,
  windows: readonly SocialWindow[],
  timeZone: string = getClubTimezone(),
  durationMinutes: number = SESSION_MINUTES
): boolean {
  const parts = clubParts(instant, timeZone);
  const start = parts.hour * 60 + parts.minute;
  return windows.some(
    (w) =>
      w.weekday === parts.weekday &&
      start >= parseTimeOfDay(w.startsTime) &&
      start + durationMinutes <= parseTimeOfDay(w.endsTime)
  );
}

/** BR-06: how far ahead a walk-in guest may book, and how far ahead the public grid and trial bookings reach. */
export const GUEST_HORIZON_DAYS = 2;
export const TRIAL_HORIZON_DAYS = 7;
