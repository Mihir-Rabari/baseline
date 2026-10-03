import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { courts, members, systemSettings, type DatabaseInstance } from '@packages/db';
import type { AvailabilityCourt, AvailabilitySlot } from '@packages/validation';
import { AvailabilityService, countActiveBookingsOnDate } from './availability.service.js';
import { clubWallTimeToInstant } from './time.js';
import { isDatabaseAvailable } from '../test-support/database.js';
import {
  createBooking,
  createCourt,
  createCourtType,
  createMaintenanceBlock,
  createMember,
  createMembership,
  createPlan,
  createSocialSession,
  createSocialWindow,
  createUserWithPolicy,
  withRollback,
} from '../test-support/court-fixtures.js';
import { getCancelCutoffHours, getClubHours, parseClubHours } from './club-settings.js';

const IST = 'Asia/Kolkata';
// Club zone used by the helpers below. Social-session tests switch it to UTC+4: the M-01 CHECK
// court_occupancies_shape requires SOCIAL occupancies to start on a UTC hour, which an IST (UTC+5:30)
// on-the-hour session can never satisfy (see the PR description).
let zone = IST;
const DUBAI = 'Asia/Dubai';
const MONDAY = '2026-10-12'; // no social window unless a test creates one
const WEDNESDAY = '2026-10-14';
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return clubWallTimeToInstant(date, h * 60 + m, zone);
};
// 00:00 IST on Monday 12 Oct: nothing is in the past yet.
const START_OF_MONDAY = at(MONDAY, '00:00');

const slotAt = (court: AvailabilityCourt, date: string, hhmm: string): AvailabilitySlot => {
  const iso = at(date, hhmm).toISOString();
  const slot = court.slots.find((s) => s.startsAt === iso);
  if (!slot) throw new Error(`no slot at ${hhmm} on ${date}; have ${court.slots.map((s) => s.startsAt).join(', ')}`);
  return slot;
};

async function setHours(db: DatabaseInstance, open: string, close: string) {
  await db
    .insert(systemSettings)
    .values({ key: 'club.hours', value: { open, close } })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: { open, close } } });
}

describe('AvailabilityService (database, rolled back per test)', () => {
  let hasDatabase = false;

  beforeAll(async () => {
    hasDatabase = await isDatabaseAvailable();
  });

  /** Runs `body` against a throwaway sport with one court, inside a rolled-back transaction. */
  async function scenario(
    ctx: { skip: () => void },
    body: (env: { db: DatabaseInstance; service: AvailabilityService; typeId: string; courtId: string; courtName: string }) => Promise<void>
  ) {
    if (!hasDatabase) return ctx.skip();
    await withRollback(async (db) => {
      await setHours(db, '06:00', '22:00');
      const type = await createCourtType(db);
      const court = await createCourt(db, type.id);
      await body({ db, service: new AvailabilityService(db, zone), typeId: type.id, courtId: court.id, courtName: court.name });
    });
  }

  it('lists half-hour starts from opening to closing minus 60 minutes, all FREE and walk-in priced', async (ctx) => {
    await scenario(ctx, async ({ service, typeId, courtId, courtName }) => {
      const result = await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now: START_OF_MONDAY });

      expect(result).toMatchObject({
        date: MONDAY,
        timezone: IST,
        generatedAt: START_OF_MONDAY.toISOString(),
        priceFor: { type: 'WALK_IN', label: 'Walk-in' },
      });
      expect(result.limits).toBeUndefined();
      expect(result.courts).toHaveLength(1);
      const court = result.courts[0];
      expect(court).toMatchObject({ courtId, name: courtName, mode: 'STANDARD' });
      expect(court.slots).toHaveLength(31); // 06:00 ... 21:00 every 30 minutes
      expect(court.slots[0]).toEqual({
        startsAt: '2026-10-12T00:30:00.000Z', // 06:00 IST
        endsAt: '2026-10-12T01:30:00.000Z',
        status: 'FREE',
        pricePaise: 60000,
      });
      expect(court.slots.at(-1)?.startsAt).toBe('2026-10-12T15:30:00.000Z'); // 21:00 IST
      expect(court.slots.every((s) => s.status === 'FREE' && s.pricePaise === 60000)).toBe(true);
    });
  });

  it('marks 18:30 (and 17:30) booked when 18:00-19:00 exists, but not 17:00 or 19:00 (half-open ranges)', async (ctx) => {
    await scenario(ctx, async ({ db, service, typeId, courtId }) => {
      const member = await createMember(db, { fullName: 'Aarav Mehta' });
      const booking = await createBooking(db, { courtId, startsAt: at(MONDAY, '18:00'), bookingDate: MONDAY, memberId: member.id });

      const staff = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'STAFF' }, now: START_OF_MONDAY })).courts[0];
      const statuses = Object.fromEntries(['17:00', '17:30', '18:00', '18:30', '19:00'].map((t) => [t, slotAt(staff, MONDAY, t).status]));
      expect(statuses).toEqual({ '17:00': 'FREE', '17:30': 'BOOKED', '18:00': 'BOOKED', '18:30': 'BOOKED', '19:00': 'FREE' });

      // Staff see who holds the court...
      expect(slotAt(staff, MONDAY, '18:30')).toMatchObject({ bookingId: booking.id, holder: 'Aarav Mehta' });
      // ...members and the public never do.
      for (const viewer of [{ kind: 'PUBLIC' as const }, { kind: 'MEMBER' as const, userId: '00000000-0000-4000-8000-000000000000' }]) {
        const court = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer, now: START_OF_MONDAY })).courts[0];
        const slot = slotAt(court, MONDAY, '18:30');
        expect(slot.status).toBe('BOOKED');
        expect(slot).not.toHaveProperty('bookingId');
        expect(slot).not.toHaveProperty('holder');
      }
    });
  });

  it('shows a guest booking holder name to staff', async (ctx) => {
    await scenario(ctx, async ({ db, service, typeId, courtId }) => {
      await createBooking(db, { courtId, startsAt: at(MONDAY, '09:00'), bookingDate: MONDAY, guestName: 'Riya Kapoor' });
      const court = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'STAFF' }, now: START_OF_MONDAY })).courts[0];
      expect(slotAt(court, MONDAY, '09:00').holder).toBe('Riya Kapoor');
    });
  });

  it('a cancelled booking (no occupancy row) leaves the court FREE', async (ctx) => {
    await scenario(ctx, async ({ db, service, typeId, courtId }) => {
      await createBooking(db, { courtId, startsAt: at(MONDAY, '10:00'), bookingDate: MONDAY, guestName: 'Gone', status: 'CANCELLED' });
      const court = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'STAFF' }, now: START_OF_MONDAY })).courts[0];
      expect(slotAt(court, MONDAY, '10:00').status).toBe('FREE');
    });
  });

  it('maintenance blocks show BLOCKED with their reason', async (ctx) => {
    await scenario(ctx, async ({ db, service, typeId, courtId }) => {
      await createMaintenanceBlock(db, { courtId, startsAt: at(MONDAY, '13:00'), endsAt: at(MONDAY, '14:30'), reason: 'Resurfacing' });
      const court = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now: START_OF_MONDAY })).courts[0];
      expect(slotAt(court, MONDAY, '13:00')).toMatchObject({ status: 'BLOCKED', reason: 'Resurfacing' });
      expect(slotAt(court, MONDAY, '13:30')).toMatchObject({ status: 'BLOCKED', reason: 'Resurfacing' });
      expect(slotAt(court, MONDAY, '14:00')).toMatchObject({ status: 'BLOCKED' }); // [14:00,15:00) overlaps until 14:30
      expect(slotAt(court, MONDAY, '14:30').status).toBe('FREE');
      expect(slotAt(court, MONDAY, '12:00').status).toBe('FREE'); // [12:00,13:00) ends where the block starts
    });
  });

  it('marks slots that have already started as PAST', async (ctx) => {
    await scenario(ctx, async ({ service, typeId }) => {
      const now = at(MONDAY, '12:30');
      const court = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).courts[0];
      expect(slotAt(court, MONDAY, '06:00').status).toBe('PAST');
      expect(slotAt(court, MONDAY, '12:00').status).toBe('PAST');
      expect(slotAt(court, MONDAY, '12:30').status).toBe('FREE'); // starting exactly now is still bookable
      expect(slotAt(court, MONDAY, '13:00').status).toBe('FREE');
    });
  });

  it('opening hours come from system_settings club.hours', async (ctx) => {
    await scenario(ctx, async ({ db, service, typeId }) => {
      await setHours(db, '08:00', '10:00');
      const court = (await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now: START_OF_MONDAY })).courts[0];
      expect(court.slots.map((s) => s.startsAt)).toEqual([
        at(MONDAY, '08:00').toISOString(),
        at(MONDAY, '08:30').toISOString(),
        at(MONDAY, '09:00').toISOString(), // last start = closing - 60 minutes
      ]);
      expect(await getClubHours(db)).toEqual({ open: '08:00', close: '10:00' });
    });
  });

  it('falls back to BR-01 hours when club.hours is missing or malformed', async (ctx) => {
    await scenario(ctx, async ({ db }) => {
      await db.delete(systemSettings).where(eq(systemSettings.key, 'club.hours'));
      expect(await getClubHours(db)).toEqual({ open: '06:00', close: '22:00' });
      expect(parseClubHours({ open: '10:00', close: '09:00' })).toBeNull();
      expect(parseClubHours({ open: 'x', close: '09:00' })).toBeNull();
      expect(parseClubHours('06:00-22:00')).toBeNull();
    });
  });

  it('reads the cancellation cutoff from system_settings with a default of 2 hours', async (ctx) => {
    await scenario(ctx, async ({ db }) => {
      await db.delete(systemSettings).where(eq(systemSettings.key, 'booking.cancel_cutoff_hours'));
      expect(await getCancelCutoffHours(db)).toBe(2);
      await db.insert(systemSettings).values({ key: 'booking.cancel_cutoff_hours', value: 4 });
      expect(await getCancelCutoffHours(db)).toBe(4);
      await db.update(systemSettings).set({ value: 'soon' }).where(eq(systemSettings.key, 'booking.cancel_cutoff_hours'));
      expect(await getCancelCutoffHours(db)).toBe(2);
    });
  });

  describe('UTC-midnight boundary', () => {
    it('keys the grid on the club day: 00:30 IST slots start on the previous UTC day', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId, courtId }) => {
        await setHours(db, '00:00', '02:00');
        const date = '2026-10-10';
        const now = at('2026-10-09', '12:00');

        let court = (await service.getAvailability({ date, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).courts[0];
        expect(court.slots.map((s) => s.startsAt)).toEqual([
          '2026-10-09T18:30:00.000Z', // 00:00 IST
          '2026-10-09T19:00:00.000Z', // 00:30 IST
          '2026-10-09T19:30:00.000Z', // 01:00 IST
        ]);

        // A booking at 00:30 IST on 10 Oct is stored on 9 Oct in UTC but belongs to the IST day 10 Oct.
        await createBooking(db, { courtId, startsAt: new Date('2026-10-09T19:00:00.000Z'), bookingDate: date, guestName: 'Night owl' });
        court = (await service.getAvailability({ date, courtTypeId: typeId, viewer: { kind: 'STAFF' }, now })).courts[0];
        expect(court.slots.map((s) => s.status)).toEqual(['BOOKED', 'BOOKED', 'BOOKED']);

        // The previous club day (9 Oct) must not see it.
        await setHours(db, '22:00', '24:00');
        const previous = (await service.getAvailability({ date: '2026-10-09', courtTypeId: typeId, viewer: { kind: 'STAFF' }, now })).courts[0];
        expect(previous.slots.map((s) => s.status)).toEqual(['FREE', 'FREE', 'FREE']); // 22:00, 22:30, 23:00
      });
    });

    it('a late-evening booking that runs past midnight blocks the first slots of the next club day only until it ends', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId, courtId }) => {
        await setHours(db, '00:00', '02:00');
        // 23:30 IST on 9 Oct (18:00Z), ending 00:30 IST on 10 Oct.
        await createBooking(db, { courtId, startsAt: new Date('2026-10-09T18:00:00.000Z'), bookingDate: '2026-10-09', guestName: 'Late' });
        const court = (await service.getAvailability({ date: '2026-10-10', courtTypeId: typeId, viewer: { kind: 'STAFF' }, now: at('2026-10-09', '12:00') })).courts[0];
        expect(court.slots.map((s) => s.status)).toEqual(['BOOKED', 'FREE', 'FREE']); // 00:00 overlaps; 00:30 starts as it ends
      });
    });
  });

  describe('Friday-style social play (BR-10)', () => {
    beforeEach(() => {
      zone = DUBAI;
    });
    afterEach(() => {
      zone = IST;
    });

    it('returns hourly social slots with capacity and spotsLeft, and standard slots outside the window', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId, courtId }) => {
        await createSocialWindow(db, { weekday: 3, startsTime: '18:00', endsTime: '22:00' }); // Wednesday
        const now = at(WEDNESDAY, '00:00');

        const open = await createSocialSession(db, { courtId, startsAt: at(WEDNESDAY, '18:00'), capacity: 4 });
        for (let i = 0; i < 3; i += 1) {
          await createBooking(db, { courtId, startsAt: at(WEDNESDAY, '18:00'), bookingDate: WEDNESDAY, guestName: `P${i}`, kind: 'SOCIAL', socialSessionId: open.id });
        }
        await createBooking(db, { courtId, startsAt: at(WEDNESDAY, '18:00'), bookingDate: WEDNESDAY, guestName: 'Dropped', kind: 'SOCIAL', socialSessionId: open.id, status: 'CANCELLED' });

        const full = await createSocialSession(db, { courtId, startsAt: at(WEDNESDAY, '19:00'), capacity: 4 });
        for (let i = 0; i < 4; i += 1) {
          await createBooking(db, { courtId, startsAt: at(WEDNESDAY, '19:00'), bookingDate: WEDNESDAY, guestName: `F${i}`, kind: 'SOCIAL', socialSessionId: full.id });
        }

        const court = (await service.getAvailability({ date: WEDNESDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).courts[0];
        expect(court.mode).toBe('SOCIAL');

        // Window slots are exactly 18:00, 19:00, 20:00, 21:00: no half-hour starts inside the window.
        const windowSlots = court.slots.filter((s) => s.startsAt >= at(WEDNESDAY, '17:30').toISOString());
        expect(windowSlots.map((s) => s.startsAt)).toEqual(['18:00', '19:00', '20:00', '21:00'].map((t) => at(WEDNESDAY, t).toISOString()));

        expect(slotAt(court, WEDNESDAY, '18:00')).toEqual({
          startsAt: at(WEDNESDAY, '18:00').toISOString(),
          endsAt: at(WEDNESDAY, '19:00').toISOString(),
          status: 'SOCIAL_OPEN',
          pricePaise: 14000,
          capacity: 4,
          spotsLeft: 1, // the cancelled participant does not hold a spot
          socialSessionId: open.id,
        });
        expect(slotAt(court, WEDNESDAY, '19:00')).toMatchObject({ status: 'SOCIAL_FULL', capacity: 4, spotsLeft: 0, socialSessionId: full.id });
        const untouched = slotAt(court, WEDNESDAY, '20:00');
        expect(untouched).toMatchObject({ status: 'SOCIAL_OPEN', capacity: 4, spotsLeft: 4 });
        expect(untouched).not.toHaveProperty('socialSessionId'); // created on the first join

        // Outside the window the court keeps normal half-hour slots, except 17:30 which would run into it.
        expect(slotAt(court, WEDNESDAY, '17:00').status).toBe('FREE');
        expect(court.slots.some((s) => s.startsAt === at(WEDNESDAY, '17:30').toISOString())).toBe(false);
      });
    });

    it('prices social slots with the social fee and the plan discount (Gold free)', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId }) => {
        await createSocialWindow(db, { weekday: 3 });
        const gold = await createPlan(db, { courtDiscountPct: 100 });
        const member = await createMember(db);
        await createMembership(db, { memberId: member.id, planId: gold.id, startsOn: '2026-10-01', endsOn: '2026-10-30' });

        const result = await service.getAvailability({ date: WEDNESDAY, courtTypeId: typeId, viewer: { kind: 'STAFF' }, memberId: member.id, now: at(WEDNESDAY, '00:00') });
        expect(slotAt(result.courts[0], WEDNESDAY, '18:00').pricePaise).toBe(0);
        expect(slotAt(result.courts[0], WEDNESDAY, '17:00').pricePaise).toBe(0);
      });
    });

    it('shows a maintenance block over a social hour as BLOCKED', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId, courtId }) => {
        await createSocialWindow(db, { weekday: 3 });
        await createMaintenanceBlock(db, { courtId, startsAt: at(WEDNESDAY, '20:00'), endsAt: at(WEDNESDAY, '21:00'), reason: 'Net repair' });
        const court = (await service.getAvailability({ date: WEDNESDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now: at(WEDNESDAY, '00:00') })).courts[0];
        expect(slotAt(court, WEDNESDAY, '20:00')).toMatchObject({ status: 'BLOCKED', reason: 'Net repair' });
        expect(slotAt(court, WEDNESDAY, '19:00').status).toBe('SOCIAL_OPEN');
      });
    });
  });

  describe('pricing and caller identity', () => {
    it('quotes a member their own plan price and returns the daily-limit hint', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId, courtId }) => {
        const silver = await createPlan(db, { code: 'SILVERX', courtDiscountPct: 30, maxBookingsPerDay: 2, bookingHorizonDays: 7 });
        const member = await createMember(db);
        const { user } = await createUserWithPolicy(db, 'MemberPolicy');
        await db.update(members).set({ userId: user.id }).where(eq(members.id, member.id));
        await createMembership(db, { memberId: member.id, planId: silver.id, startsOn: '2026-10-01', endsOn: '2026-10-30' });
        await createBooking(db, { courtId, startsAt: at(MONDAY, '07:00'), bookingDate: MONDAY, memberId: member.id });
        await createBooking(db, { courtId, startsAt: at(MONDAY, '09:00'), bookingDate: MONDAY, memberId: member.id, status: 'CANCELLED', cancelledLate: true });
        await createBooking(db, { courtId, startsAt: at(MONDAY, '11:00'), bookingDate: MONDAY, memberId: member.id, status: 'CANCELLED', cancelledLate: false });

        const result = await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'MEMBER', userId: user.id }, now: START_OF_MONDAY });
        expect(result.priceFor).toEqual({ type: 'MEMBER', label: 'SILVERX', memberId: member.id });
        expect(result.limits).toEqual({ usedToday: 2, maxPerDay: 2 }); // confirmed + late cancel; in-time cancel is free
        expect(slotAt(result.courts[0], MONDAY, '15:00')).toMatchObject({ status: 'FREE', pricePaise: 42000 }); // FREE stays FREE at the limit
      });
    });

    it('a member cannot request another member\'s price (403) and an unknown memberId for staff is 404', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId }) => {
        const { user } = await createUserWithPolicy(db, 'MemberPolicy');
        const me = await createMember(db, { userId: user.id });
        const other = await createMember(db);

        await expect(
          service.getAvailability({ date: MONDAY, courtTypeId: typeId, memberId: other.id, viewer: { kind: 'MEMBER', userId: user.id }, now: START_OF_MONDAY })
        ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

        // Asking for their own id is fine.
        const own = await service.getAvailability({ date: MONDAY, courtTypeId: typeId, memberId: me.id, viewer: { kind: 'MEMBER', userId: user.id }, now: START_OF_MONDAY });
        expect(own.priceFor.memberId).toBe(me.id);

        await expect(
          service.getAvailability({ date: MONDAY, courtTypeId: typeId, memberId: '00000000-0000-4000-8000-0000000000aa', viewer: { kind: 'STAFF' }, now: START_OF_MONDAY })
        ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
      });
    });

    it('staff pricing for a member whose membership expired gets the walk-in price', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId }) => {
        const gold = await createPlan(db, { courtDiscountPct: 100 });
        const member = await createMember(db);
        await createMembership(db, { memberId: member.id, planId: gold.id, startsOn: '2026-08-01', endsOn: '2026-08-30', status: 'EXPIRED' });
        const result = await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'STAFF' }, memberId: member.id, now: START_OF_MONDAY });
        expect(result.priceFor).toMatchObject({ type: 'WALK_IN', memberId: member.id });
        expect(result.courts[0].slots[0].pricePaise).toBe(60000);
        expect(result.limits).toEqual({ usedToday: 0, maxPerDay: 2 });
      });
    });

    it('staff without memberId see walk-in prices and no limits', async (ctx) => {
      await scenario(ctx, async ({ service, typeId }) => {
        const result = await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'STAFF' }, now: START_OF_MONDAY });
        expect(result.priceFor).toEqual({ type: 'WALK_IN', label: 'Walk-in' });
        expect(result.limits).toBeUndefined();
      });
    });

    it('counts daily bookings per BR-04', async (ctx) => {
      await scenario(ctx, async ({ db, courtId }) => {
        const member = await createMember(db);
        expect(await countActiveBookingsOnDate(db, member.id, MONDAY)).toBe(0);
        await createBooking(db, { courtId, startsAt: at(MONDAY, '07:00'), bookingDate: MONDAY, memberId: member.id, status: 'NO_SHOW' });
        await createBooking(db, { courtId, startsAt: at(MONDAY, '08:00'), bookingDate: MONDAY, memberId: member.id, status: 'COMPLETED' });
        expect(await countActiveBookingsOnDate(db, member.id, MONDAY)).toBe(2);
        expect(await countActiveBookingsOnDate(db, member.id, '2026-10-13')).toBe(0);
      });
    });
  });

  describe('booking horizon (BR-06)', () => {
    it('guests may look 2 days ahead, not 3', async (ctx) => {
      await scenario(ctx, async ({ service, typeId }) => {
        const now = at('2026-10-10', '10:00');
        await expect(service.getAvailability({ date: '2026-10-12', courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).resolves.toMatchObject({ date: '2026-10-12' });
        await expect(service.getAvailability({ date: '2026-10-13', courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).rejects.toMatchObject({
          code: 'BEYOND_BOOKING_HORIZON',
          statusCode: 422,
        });
      });
    });

    it('measures the horizon in club days, not UTC days (00:30 IST is still yesterday in UTC)', async (ctx) => {
      await scenario(ctx, async ({ service, typeId }) => {
        const now = new Date('2026-10-09T19:00:00.000Z'); // 00:30 IST on 10 Oct
        await expect(service.getAvailability({ date: '2026-10-12', courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).resolves.toBeDefined();
        await expect(service.getAvailability({ date: '2026-10-13', courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now })).rejects.toMatchObject({ code: 'BEYOND_BOOKING_HORIZON' });
      });
    });

    it('members get their plan horizon, staff-with-member too, anonymous staff view is unrestricted', async (ctx) => {
      await scenario(ctx, async ({ db, service, typeId }) => {
        const plan = await createPlan(db, { bookingHorizonDays: 7 });
        const member = await createMember(db);
        await createMembership(db, { memberId: member.id, planId: plan.id, startsOn: '2026-10-01', endsOn: '2026-12-30' });
        const now = at('2026-10-10', '10:00');

        await expect(service.getAvailability({ date: '2026-10-17', courtTypeId: typeId, viewer: { kind: 'STAFF' }, memberId: member.id, now })).resolves.toBeDefined();
        await expect(service.getAvailability({ date: '2026-10-18', courtTypeId: typeId, viewer: { kind: 'STAFF' }, memberId: member.id, now })).rejects.toMatchObject({ code: 'BEYOND_BOOKING_HORIZON' });
        await expect(service.getAvailability({ date: '2026-11-18', courtTypeId: typeId, viewer: { kind: 'STAFF' }, now })).resolves.toBeDefined();
      });
    });
  });

  it('filters by court type, orders by sort order and skips inactive courts', async (ctx) => {
    await scenario(ctx, async ({ db, service, typeId, courtId }) => {
      const second = await createCourt(db, typeId, 'Second', -1); // sorts first
      const retired = await createCourt(db, typeId, 'Retired');
      await db.update(courts).set({ isActive: false }).where(eq(courts.id, retired.id));
      const otherType = await createCourtType(db);
      await createCourt(db, otherType.id);

      const result = await service.getAvailability({ date: MONDAY, courtTypeId: typeId, viewer: { kind: 'PUBLIC' }, now: START_OF_MONDAY });
      expect(result.courts.map((c) => c.courtId)).toEqual([second.id, courtId]);
    });
  });

  it('returns an empty grid for a court type with no courts', async (ctx) => {
    await scenario(ctx, async ({ db, service }) => {
      const empty = await createCourtType(db);
      const result = await service.getAvailability({ date: MONDAY, courtTypeId: empty.id, viewer: { kind: 'PUBLIC' }, now: START_OF_MONDAY });
      expect(result.courts).toEqual([]);
    });
  });
});
