/**
 * Club-local calendar helpers. Business dates (`ends_on`, `starts_on`) are `YYYY-MM-DD` in the
 * club time zone, so "today" must never be taken from the UTC date.
 */

/** The `YYYY-MM-DD` date of `instant` in the IANA time zone `timeZone`. */
export function clubDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Adds (or subtracts) whole calendar days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** `later - earlier` in whole calendar days. */
export function diffDays(later: string, earlier: string): number {
  return Math.round((toUtcMs(later) - toUtcMs(earlier)) / 86_400_000);
}

/** Completed years between `dateOfBirth` and `onDate` (both `YYYY-MM-DD`). */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = onDate.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}
