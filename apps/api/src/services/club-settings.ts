import { eq } from 'drizzle-orm';
import { systemSettings, type DatabaseInstance } from '@packages/db';
import { parseTimeOfDay, type OpeningHours } from './time.js';

/**
 * Typed readers for the CourtOS keys stored in `system_settings` (ARCHITECTURE_AND_DATABASE.md
 * section 5.10). The values come from the database so the Owner can change them; the constants
 * below are only the documented defaults used when a key is missing or malformed.
 */

export const CLUB_HOURS_KEY = 'club.hours';
export const CANCEL_CUTOFF_HOURS_KEY = 'booking.cancel_cutoff_hours';

export const DEFAULT_CLUB_HOURS: OpeningHours = { open: '06:00', close: '22:00' }; // BR-01
export const DEFAULT_CANCEL_CUTOFF_HOURS = 2; // BR-08

async function readSetting(db: DatabaseInstance, key: string): Promise<unknown> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row?.value;
}

/** Parses a `{ open, close }` setting, returning `null` unless it is a valid, non-empty range. */
export function parseClubHours(value: unknown): OpeningHours | null {
  if (!value || typeof value !== 'object') return null;
  const { open, close } = value as { open?: unknown; close?: unknown };
  if (typeof open !== 'string' || typeof close !== 'string') return null;
  try {
    return parseTimeOfDay(open) < parseTimeOfDay(close) ? { open, close } : null;
  } catch {
    return null;
  }
}

export async function getClubHours(db: DatabaseInstance): Promise<OpeningHours> {
  return parseClubHours(await readSetting(db, CLUB_HOURS_KEY)) ?? DEFAULT_CLUB_HOURS;
}

export async function getCancelCutoffHours(db: DatabaseInstance): Promise<number> {
  const value = await readSetting(db, CANCEL_CUTOFF_HOURS_KEY);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_CANCEL_CUTOFF_HOURS;
}
