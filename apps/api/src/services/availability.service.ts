import { and, asc, eq, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import {
  bookings,
  courtOccupancies,
  courtTypes,
  courts,
  members,
  socialSessions,
  socialWindows,
  type DatabaseInstance,
} from '@packages/db';
import type { Availability, AvailabilityCourt, AvailabilitySlot } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { getClubHours } from './club-settings.js';
import {
  PricingService,
  walkInEntitlements,
  type CourtTypePricing,
  type Entitlements,
} from './pricing.service.js';
import {
  SESSION_MINUTES,
  SLOT_STEP_MINUTES,
  addDays,
  clubDateOf,
  clubWallTimeToInstant,
  daysBetween,
  dayRange,
  TRIAL_HORIZON_DAYS,
  isoWeekdayOf,
  parseTimeOfDay,
} from './time.js';

/**
 * Who is asking. It decides the price the grid is quoted in and whether holder details are shown.
 *  - PUBLIC: no login, walk-in price, no booking details, trial horizon, 7 days (BR-06).
 *  - MEMBER: a logged-in member; always priced as themselves, no holder details.
 *  - STAFF:  front desk / owner; may price for `memberId`, otherwise walk-in; sees holders.
 */
export type AvailabilityViewer =
  | { kind: 'PUBLIC' }
  | { kind: 'MEMBER'; userId: string }
  | { kind: 'STAFF'; memberId?: string };

export interface AvailabilityParams {
  date: string;
  courtTypeId?: string;
  /** Requested price-for member (STAFF) or an attempt to price as someone else (MEMBER, refused). */
  memberId?: string;
  viewer: AvailabilityViewer;
  /** Injectable clock for tests. */
  now?: Date;
}

interface Interval {
  start: number;
  end: number;
}

const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Booking statuses that count towards the BR-04 daily limit (late cancellations keep the quota). */
export async function countActiveBookingsOnDate(
  db: DatabaseInstance,
  memberId: string,
  bookingDate: string
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.memberId, memberId),
        eq(bookings.bookingDate, bookingDate),
        or(
          inArray(bookings.status, ['CONFIRMED', 'COMPLETED', 'NO_SHOW']),
          and(eq(bookings.status, 'CANCELLED'), eq(bookings.cancelledLate, true))
        )
      )
    );
  return row?.total ?? 0;
}

export class AvailabilityService {
  private readonly pricing: PricingService;

  constructor(
    private readonly db: DatabaseInstance,
    private readonly timeZone: string
  ) {
    this.pricing = new PricingService(db);
  }

  async getAvailability(params: AvailabilityParams): Promise<Availability> {
    const { date, courtTypeId, viewer } = params;
    const now = params.now ?? new Date();
    const tz = this.timeZone;
    const isStaff = viewer.kind === 'STAFF';

    // ---- 1. Who is being priced -------------------------------------------------------------
    let pricedMemberId: string | undefined;
    if (viewer.kind === 'MEMBER') {
      const [own] = await this.db.select({ id: members.id }).from(members).where(eq(members.userId, viewer.userId)).limit(1);
      if (params.memberId && params.memberId !== own?.id) {
        // A member can never obtain another member's price or quota.
        throw new DomainError('FORBIDDEN', 403, 'You can only view availability priced for yourself.');
      }
      pricedMemberId = own?.id;
    } else if (viewer.kind === 'STAFF') {
      pricedMemberId = params.memberId ?? viewer.memberId;
    }

    let memberName: string | undefined;
    if (pricedMemberId) {
      const [row] = await this.db.select({ fullName: members.fullName }).from(members).where(eq(members.id, pricedMemberId)).limit(1);
      if (!row) {
        throw new DomainError('NOT_FOUND', 404, 'Member not found.');
      }
      memberName = row.fullName;
    }

    const entitlements: Entitlements = pricedMemberId
      ? await this.pricing.resolveEntitlements(pricedMemberId, date)
      : walkInEntitlements();
    // The public grid exists to pick a trial slot, so it reaches as far as a trial booking does (BR-06).
    // A walk-in guest booked by staff keeps the shorter guest horizon in BookingService.
    if (viewer.kind === 'PUBLIC') entitlements.bookingHorizonDays = TRIAL_HORIZON_DAYS;

    // ---- 2. Booking horizon (BR-06) ---------------------------------------------------------
    // Staff pricing for an anonymous walk-in are not limited: the desk books same-week phone enquiries.
    const horizonApplies = viewer.kind !== 'STAFF' || pricedMemberId !== undefined;
    if (horizonApplies) {
      const daysAhead = daysBetween(clubDateOf(now, tz), date);
      if (daysAhead > entitlements.bookingHorizonDays) {
        throw new DomainError(
          'BEYOND_BOOKING_HORIZON',
          422,
          `Bookings open ${entitlements.bookingHorizonDays} day${entitlements.bookingHorizonDays === 1 ? '' : 's'} ahead.`,
          [{ field: 'date', message: `Latest bookable date is ${addDays(clubDateOf(now, tz), entitlements.bookingHorizonDays)}`, code: 'BEYOND_BOOKING_HORIZON' }]
        );
      }
    }

    // ---- 3. Reference data ------------------------------------------------------------------
    const hours = await getClubHours(this.db);
    const range = dayRange(date, tz);
    const weekday = isoWeekdayOf(date);

    const windowRows = await this.db
      .select({ startsTime: socialWindows.startsTime, endsTime: socialWindows.endsTime })
      .from(socialWindows)
      .where(and(eq(socialWindows.weekday, weekday), eq(socialWindows.isActive, true)));
    const windows: Interval[] = windowRows.map((w) => ({
      start: clubWallTimeToInstant(date, parseTimeOfDay(w.startsTime), tz).getTime(),
      end: clubWallTimeToInstant(date, parseTimeOfDay(w.endsTime), tz).getTime(),
    }));

    const courtRows = await this.db
      .select({
        courtId: courts.id,
        name: courts.name,
        typeCode: courtTypes.code,
        baseRatePaise: courtTypes.baseRatePaise,
        socialFeePaise: courtTypes.socialFeePaise,
        trialFeePaise: courtTypes.trialFeePaise,
        socialCapacity: courtTypes.socialCapacity,
      })
      .from(courts)
      .innerJoin(courtTypes, eq(courtTypes.id, courts.courtTypeId))
      .where(
        and(
          eq(courts.isActive, true),
          eq(courtTypes.isActive, true),
          courtTypeId ? eq(courts.courtTypeId, courtTypeId) : undefined
        )
      )
      .orderBy(asc(courts.sortOrder), asc(courts.name));

    const courtIds = courtRows.map((c) => c.courtId);
    const occupancyRows = courtIds.length
      ? await this.db
          .select({
            courtId: courtOccupancies.courtId,
            startsAt: courtOccupancies.startsAt,
            endsAt: courtOccupancies.endsAt,
            kind: courtOccupancies.kind,
            reason: courtOccupancies.reason,
            bookingId: courtOccupancies.bookingId,
            memberName: members.fullName,
            guestName: bookings.guestName,
          })
          .from(courtOccupancies)
          .leftJoin(bookings, eq(bookings.id, courtOccupancies.bookingId))
          .leftJoin(members, eq(members.id, bookings.memberId))
          .where(
            and(
              inArray(courtOccupancies.courtId, courtIds),
              lt(courtOccupancies.startsAt, range.end),
              gt(courtOccupancies.endsAt, range.start)
            )
          )
          .orderBy(asc(courtOccupancies.startsAt))
      : [];

    const sessionRows = courtIds.length
      ? await this.db
          .select({
            id: socialSessions.id,
            courtId: socialSessions.courtId,
            startsAt: socialSessions.startsAt,
            capacity: socialSessions.capacity,
            // A cancelled participant no longer holds a spot (BR-08 frees the court-hour seat).
            joined: sql<number>`count(${bookings.id})::int`,
          })
          .from(socialSessions)
          .leftJoin(bookings, and(eq(bookings.socialSessionId, socialSessions.id), ne(bookings.status, 'CANCELLED')))
          .where(
            and(
              inArray(socialSessions.courtId, courtIds),
              eq(socialSessions.status, 'OPEN'),
              lt(socialSessions.startsAt, range.end),
              gte(socialSessions.startsAt, range.start)
            )
          )
          .groupBy(socialSessions.id)
      : [];

    // ---- 4. Build the grid ------------------------------------------------------------------
    const openMinutes = parseTimeOfDay(hours.open);
    const lastStartMinutes = parseTimeOfDay(hours.close) - SESSION_MINUTES;

    const courtsOut: AvailabilityCourt[] = courtRows.map((court) => {
      const courtType: CourtTypePricing = {
        baseRatePaise: court.baseRatePaise,
        socialFeePaise: court.socialFeePaise,
        trialFeePaise: court.trialFeePaise,
      };
      const standardPrice = this.pricing.priceFor({ courtType, plan: entitlements, kind: 'STANDARD' }).pricePaise;
      const socialPrice = this.pricing.priceFor({ courtType, plan: entitlements, kind: 'SOCIAL' }).pricePaise;

      const occupancies = occupancyRows
        .filter((o) => o.courtId === court.courtId)
        .map((o) => ({ ...o, start: o.startsAt.getTime(), end: o.endsAt.getTime() }));
      const sessions = sessionRows.filter((s) => s.courtId === court.courtId);

      const slots: AvailabilitySlot[] = [];

      for (let minutes = openMinutes; minutes <= lastStartMinutes; minutes += SLOT_STEP_MINUTES) {
        const startsAt = clubWallTimeToInstant(date, minutes, tz);
        const endsAt = clubWallTimeToInstant(date, minutes + SESSION_MINUTES, tz);
        const slot: Interval = { start: startsAt.getTime(), end: endsAt.getTime() };

        // BR-10: a half-hour start can never coexist with an hourly shared session, so any slot that
        // touches a social window is either a whole on-the-hour social block or not offered at all.
        const touchingWindow = windows.find((w) => overlaps(slot, w));
        const isSocial = touchingWindow !== undefined && slot.start >= touchingWindow.start && slot.end <= touchingWindow.end && minutes % 60 === 0;
        if (touchingWindow && !isSocial) continue;

        const overlapping = occupancies.filter((o) => overlaps(slot, o));
        const maintenance = overlapping.find((o) => o.kind === 'MAINTENANCE');
        const booking = overlapping.find((o) => o.kind !== 'MAINTENANCE' && !(isSocial && o.kind === 'SOCIAL'));
        const isPast = slot.start < now.getTime();

        const base = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };

        if (isSocial) {
          const session = sessions.find((s) => s.startsAt.getTime() === slot.start);
          const socialBase = { ...base, pricePaise: socialPrice };
          if (maintenance) {
            slots.push({ ...socialBase, status: 'BLOCKED', ...(maintenance.reason ? { reason: maintenance.reason } : {}) });
          } else if (booking) {
            slots.push({ ...socialBase, status: 'BOOKED', ...this.holderFields(isStaff, booking) });
          } else {
            const capacity = session?.capacity ?? court.socialCapacity;
            const spotsLeft = Math.max(0, capacity - (session?.joined ?? 0));
            const status = spotsLeft === 0 ? 'SOCIAL_FULL' : isPast ? 'PAST' : 'SOCIAL_OPEN';
            slots.push({
              ...socialBase,
              status,
              capacity,
              spotsLeft,
              ...(session ? { socialSessionId: session.id } : {}),
            });
          }
          continue;
        }

        const standardBase = { ...base, pricePaise: standardPrice };
        if (maintenance) {
          slots.push({ ...standardBase, status: 'BLOCKED', ...(maintenance.reason ? { reason: maintenance.reason } : {}) });
        } else if (booking) {
          slots.push({ ...standardBase, status: 'BOOKED', ...this.holderFields(isStaff, booking) });
        } else {
          slots.push({ ...standardBase, status: isPast ? 'PAST' : 'FREE' });
        }
      }

      return {
        courtId: court.courtId,
        name: court.name,
        type: court.typeCode,
        mode: windows.length > 0 ? ('SOCIAL' as const) : ('STANDARD' as const),
        slots,
      };
    });

    const result: Availability = {
      date,
      timezone: tz,
      generatedAt: now.toISOString(),
      priceFor: entitlements.isMember && entitlements.plan
        ? { type: 'MEMBER', label: entitlements.plan.name, ...(pricedMemberId ? { memberId: pricedMemberId } : {}) }
        : { type: 'WALK_IN', label: 'Walk-in', ...(pricedMemberId ? { memberId: pricedMemberId } : {}) },
      courts: courtsOut,
    };

    // The daily-limit hint is only meaningful for a specific member (MEM, or FD with memberId).
    if (pricedMemberId && memberName !== undefined) {
      result.limits = {
        usedToday: await countActiveBookingsOnDate(this.db, pricedMemberId, date),
        maxPerDay: entitlements.maxBookingsPerDay,
      };
    }

    return result;
  }

  /** Holder details are staff-only: members and the public never learn who holds a slot. */
  private holderFields(
    isStaff: boolean,
    occupancy: { bookingId: string | null; memberName: string | null; guestName: string | null }
  ): Pick<AvailabilitySlot, 'bookingId' | 'holder'> {
    if (!isStaff || !occupancy.bookingId) return {};
    const holder = occupancy.memberName ?? occupancy.guestName ?? undefined;
    return { bookingId: occupancy.bookingId, ...(holder ? { holder } : {}) };
  }
}
