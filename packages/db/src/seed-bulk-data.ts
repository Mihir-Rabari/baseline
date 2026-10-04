/**
 * Pure, deterministic generator for the bulk demo dataset (no database access).
 *
 * The same `seed` always yields the same rows, so re-running the loader is idempotent
 * (every row is keyed on a stable natural key) and tests can assert exact counts.
 */

export interface BulkOptions {
  userCount: number;
  /** Club-local date (YYYY-MM-DD) the history is anchored to. */
  today: string;
  /** Days of booking history before `today` and days of upcoming bookings after it. */
  pastDays: number;
  futureDays: number;
  seed: number;
}

export const BULK_DEFAULTS: BulkOptions = { userCount: 450, today: '2026-01-01', pastDays: 60, futureDays: 14, seed: 20260101 };

export const BULK_EMAIL_DOMAIN = 'baseline.test';
export const BULK_MEMBER_CODE_START = 1001; // CC-001001..; the base demo seed uses CC-000001..CC-000040

/** Extra courts so the club has 10 in total (the base seed ships 8). */
export const EXTRA_COURTS = [
  { type: 'TENNIS', name: 'Tennis Court 3' },
  { type: 'PADEL', name: 'Padel Court 3' },
] as const;

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Ishaan', 'Kabir', 'Rohan', 'Siddharth', 'Nikhil', 'Rahul', 'Karthik', 'Varun', 'Dev', 'Yash', 'Harsh', 'Manav', 'Tejas', 'Ayaan', 'Reyansh', 'Krish',
  'Neha', 'Priya', 'Ananya', 'Diya', 'Kavya', 'Meera', 'Riya', 'Sana', 'Tara', 'Zoya', 'Isha', 'Pooja', 'Aditi', 'Nisha', 'Shreya', 'Anjali', 'Lakshmi', 'Divya', 'Mira', 'Sneha',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Patel', 'Mehta', 'Khan', 'Singh', 'Das', 'Gupta', 'Joshi', 'Rao', 'Menon', 'Kulkarni', 'Bose', 'Chatterjee', 'Pillai', 'Shetty', 'Kapoor',
  'Malhotra', 'Bhatt', 'Desai', 'Naidu', 'Hegde', 'Banerjee', 'Agarwal', 'Chopra', 'Saxena', 'Thakur',
];

/** mulberry32: tiny seedable PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type BulkTier = 'GOLD' | 'SILVER' | 'JUNIOR';
export type BulkUserStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface BulkUser {
  email: string;
  name: string;
  status: BulkUserStatus;
  memberCode: string;
  phone: string;
  dateOfBirth: string;
  tier: BulkTier;
  /** Membership terms, oldest first. At most the last one is ACTIVE. */
  memberships: Array<{ status: 'ACTIVE' | 'EXPIRED'; startsOn: string; endsOn: string }>;
}

export function generateUsers(opts: BulkOptions): BulkUser[] {
  const rng = makeRng(opts.seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const users: BulkUser[] = [];
  for (let i = 0; i < opts.userCount; i++) {
    const n = i + 1;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const roll = rng();
    // 60% Silver, 25% Gold, 15% Junior.
    const tier: BulkTier = roll < 0.25 ? 'GOLD' : roll < 0.85 ? 'SILVER' : 'JUNIOR';
    const age = tier === 'JUNIOR' ? 8 + Math.floor(rng() * 10) : 18 + Math.floor(rng() * 47);
    const statusRoll = rng();
    const status: BulkUserStatus = statusRoll < 0.93 ? 'ACTIVE' : statusRoll < 0.97 ? 'SUSPENDED' : 'DISABLED';

    // Membership history: ~15% lapsed (only expired terms), others active, some with a prior expired term.
    const lapsed = rng() < 0.15;
    const terms: BulkUser['memberships'] = [];
    if (!lapsed && rng() < 0.3) {
      const start = addDays(opts.today, -(90 + Math.floor(rng() * 200)));
      terms.push({ status: 'EXPIRED', startsOn: start, endsOn: addDays(start, 30) });
    }
    if (lapsed) {
      const ended = addDays(opts.today, -(1 + Math.floor(rng() * 120)));
      terms.push({ status: 'EXPIRED', startsOn: addDays(ended, -30), endsOn: ended });
    } else {
      const endsOn = addDays(opts.today, 1 + Math.floor(rng() * 28));
      terms.push({ status: 'ACTIVE', startsOn: addDays(endsOn, -30), endsOn });
    }

    users.push({
      email: `bulk.user${String(n).padStart(4, '0')}@${BULK_EMAIL_DOMAIN}`,
      name: `${first} ${last}`,
      status,
      memberCode: `CC-${String(BULK_MEMBER_CODE_START + i).padStart(6, '0')}`,
      phone: `9${String(100000000 + Math.floor(rng() * 899999999)).slice(0, 9)}`,
      dateOfBirth: addDays(opts.today, -(age * 365 + Math.floor(rng() * 300))),
      tier,
      memberships: terms,
    });
  }
  return users;
}

export interface BulkBooking {
  userIndex: number;
  courtName: string;
  /** Club-local calendar date and start hour (whole hours, 1h slots). */
  date: string;
  hour: number;
  status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  channel: 'DESK' | 'PHONE' | 'ONLINE';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'WAIVED';
  cancelledLate: boolean;
}

/** Court names the generator books; must exist (base seed courts + EXTRA_COURTS). */
export const ALL_COURT_NAMES = [
  'Tennis Court 1', 'Tennis Court 2', 'Tennis Court 3',
  'Padel Court 1', 'Padel Court 2', 'Padel Court 3',
  'Badminton Court 1', 'Badminton Court 2',
  'Cricket Net 1', 'Cricket Net 2',
] as const;

const OPEN_HOUR = 6;
const CLOSE_HOUR = 22;

/**
 * Bookings across every court. A court never has two bookings in one slot and a member never
 * has two in one hour (the database enforces both). Peak evening hours are busier. Only ACTIVE
 * users with an active membership book, and only paid/completed states appear in the past.
 */
export function generateBookings(opts: BulkOptions, users: BulkUser[]): BulkBooking[] {
  const rng = makeRng(opts.seed ^ 0x9e3779b9);
  const eligible = users
    .map((u, index) => ({ u, index }))
    .filter(({ u }) => u.status === 'ACTIVE' && u.memberships.some((m) => m.status === 'ACTIVE'));
  const busy = new Set<string>(); // `${userIndex}|${date}|${hour}`
  const out: BulkBooking[] = [];

  for (let day = -opts.pastDays; day <= opts.futureDays; day++) {
    const date = addDays(opts.today, day);
    const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    for (const courtName of ALL_COURT_NAMES) {
      for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour++) {
        const peak = hour >= 17 && hour <= 20;
        const base = peak ? 0.7 : hour >= 6 && hour <= 9 ? 0.4 : 0.18;
        if (rng() > Math.min(0.9, base * (weekend ? 1.25 : 1))) continue;

        let who = eligible[Math.floor(rng() * eligible.length)];
        for (let tries = 0; tries < 5 && busy.has(`${who.index}|${date}|${hour}`); tries++) {
          who = eligible[Math.floor(rng() * eligible.length)];
        }
        const key = `${who.index}|${date}|${hour}`;
        if (busy.has(key)) continue;

        const roll = rng();
        let status: BulkBooking['status'];
        let paymentStatus: BulkBooking['paymentStatus'];
        let cancelledLate = false;
        if (day >= 0) {
          status = roll < 0.1 ? 'CANCELLED' : 'CONFIRMED';
          paymentStatus = status === 'CANCELLED' ? 'UNPAID' : roll < 0.5 ? 'PAID' : 'UNPAID';
        } else if (roll < 0.1) {
          status = 'CANCELLED';
          cancelledLate = rng() < 0.4;
          paymentStatus = cancelledLate ? 'PAID' : 'UNPAID';
        } else if (roll < 0.15) {
          status = 'NO_SHOW';
          paymentStatus = 'UNPAID';
        } else {
          status = 'COMPLETED';
          paymentStatus = who.u.tier === 'GOLD' ? 'WAIVED' : 'PAID';
        }
        // A cancelled booking frees its slot for the member too (matches the database constraint).
        if (status !== 'CANCELLED') busy.add(key);
        out.push({
          userIndex: who.index,
          courtName,
          date,
          hour,
          status,
          channel: (['DESK', 'PHONE', 'ONLINE', 'ONLINE', 'ONLINE'] as const)[Math.floor(rng() * 5)],
          paymentStatus,
          cancelledLate,
        });
      }
    }
  }
  return out;
}
