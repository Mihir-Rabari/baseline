import type { TableBooking } from '@packages/validation';

/** The club runs on one wall clock; the rest of the web app assumes the same zone. */
export const CLUB_TZ = 'Asia/Kolkata';
export const SNAP_MINUTES = 15;
export const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** BOOKED and SEATED bookings hold their table; closed ones are history. */
export const holdsTable = (b: Pick<TableBooking, 'status'>) => b.status === 'BOOKED' || b.status === 'SEATED';

function offsetAt(ms: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the club wall clock reads `date` + `minutes` (minutes may pass 1440 for the next day). */
export function clubInstant(date: string, minutes: number, tz = CLUB_TZ): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const first = wall - offsetAt(wall, tz);
  return wall - offsetAt(first, tz);
}

/** Minutes since club midnight of `date` for an instant (can be negative or above 1440). */
export const minutesOfDay = (ms: number, date: string, tz = CLUB_TZ) => Math.round((ms - clubInstant(date, 0, tz)) / MINUTE);

export const snap = (ms: number, step = SNAP_MINUTES) => Math.round(ms / (step * MINUTE)) * (step * MINUTE);

/** `HH:MM` club time of an instant, for time inputs. */
export function clubTimeInput(ms: number, tz = CLUB_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** `5:30 pm` style label for the axis and the bars. */
export function clubTimeLabel(ms: number, tz = CLUB_TZ): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)).replace(/\s?([ap])m/i, (_, x: string) => ` ${x.toLowerCase()}m`);
}

export interface TimelineRange { startMs: number; endMs: number; startHour: number; endHour: number }

/**
 * The window the timeline shows: 8:00 to midnight by default, widened to whole hours so that a late
 * or early booking is never cut off.
 */
export function timelineRange(date: string, bookings: Array<Pick<TableBooking, 'startsAt' | 'endsAt'>>, tz = CLUB_TZ): TimelineRange {
  let startHour = 8;
  let endHour = 24;
  for (const b of bookings) {
    const s = minutesOfDay(Date.parse(b.startsAt), date, tz);
    const e = minutesOfDay(Date.parse(b.endsAt), date, tz);
    startHour = Math.min(startHour, Math.max(0, Math.floor(s / 60)));
    endHour = Math.max(endHour, Math.min(48, Math.ceil(e / 60)));
  }
  return { startMs: clubInstant(date, startHour * 60, tz), endMs: clubInstant(date, endHour * 60, tz), startHour, endHour };
}

export const percentAt = (ms: number, range: TimelineRange) => ((ms - range.startMs) / (range.endMs - range.startMs)) * 100;

export interface Candidate { id?: string; tableId: string; startMs: number; endMs: number }

/** The first holding booking on the same table that overlaps the candidate (touching edges do not overlap). */
export function findConflict(bookings: TableBooking[], c: Candidate): TableBooking | undefined {
  return bookings.find(
    (b) => b.id !== c.id && holdsTable(b) && b.tableId === c.tableId && Date.parse(b.startsAt) < c.endMs && Date.parse(b.endsAt) > c.startMs
  );
}

export type DragMode = 'move' | 'resize';

/**
 * Applies a drag to a booking: a move shifts both ends (and may change table); a resize moves only the
 * end. Times snap to the grid, the length never drops below one step, and a move keeps its length.
 */
export function applyDrag(
  origin: { tableId: string; startMs: number; endMs: number },
  mode: DragMode,
  deltaMs: number,
  tableId: string
): { tableId: string; startMs: number; endMs: number } {
  const step = SNAP_MINUTES * MINUTE;
  if (mode === 'resize') {
    const endMs = Math.max(origin.startMs + step, snap(origin.endMs + deltaMs));
    return { tableId: origin.tableId, startMs: origin.startMs, endMs: Math.min(endMs, origin.startMs + 12 * HOUR) };
  }
  const length = origin.endMs - origin.startMs;
  const startMs = snap(origin.startMs + deltaMs);
  return { tableId, startMs, endMs: startMs + length };
}
