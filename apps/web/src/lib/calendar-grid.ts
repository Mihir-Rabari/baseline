import { dateAfter } from '@/lib/booking-calendar';

export interface DayCell { date: string; inMonth: boolean }

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10` for a date. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The first day of the month after (or before) the one containing `date`. */
export function shiftMonth(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

/** The day of the week for a date, Monday = 0 ... Sunday = 6. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Six Monday-first weeks (42 cells) covering the month that contains `date`. */
export function monthGrid(date: string): DayCell[] {
  const first = `${monthOf(date)}-01`;
  const start = dateAfter(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, i) => {
    const day = dateAfter(start, i);
    return { date: day, inMonth: monthOf(day) === monthOf(date) };
  });
}

/** The Monday of the week that contains `date`. */
export const mondayOf = (date: string) => dateAfter(date, -weekdayIndex(date));

export const clampDate = (date: string, min?: string, max?: string) => (min && date < min ? min : max && date > max ? max : date);

export function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

export function formatMonth(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

export const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
