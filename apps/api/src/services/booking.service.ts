import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  bookings,
  courtOccupancies,
  courtTypes,
  courts,
  members,
  payments,
  socialSessions,
  socialWindows,
  type BookingChannel,
  type BookingKind,
  type BookingPaymentStatus,
  type BookingStatus,
  type DatabaseInstance,
  type PaymentMethod,
} from '@packages/db';
import type { Booking, BookingListQuery } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import type { DbExecutor } from './db-types.js';
import { getCancelCutoffHours, getClubHours } from './club-settings.js';
import { PaymentService } from './payment.service.js';
import { PricingService, priceFor, walkInEntitlements, type Entitlements } from './pricing.service.js';
import {
  clubDateOf,
  clubMinutesOfDay,
  daysBetween,
  GUEST_HORIZON_DAYS,
  TRIAL_HORIZON_DAYS,
  isInOpeningHours,
  isInSocialWindow,
  isSlotStart,
  SESSION_MINUTES,
} from './time.js';

/**
 * BookingService (M-07 / M-08): the booking engine.
 *
 * Correctness rests on the database, not on application checks:
 *  - `court_occupancies_no_overlap` (EXCLUDE gist) makes a double booking impossible (BR-03);
 *  - `bookings_member_no_overlap` stops one member holding two overlapping sessions;
 *  - a per member-and-day advisory lock serialises the daily limit (BR-04);
 *  - a `FOR UPDATE` lock on the social session row makes the capacity count exact (BR-10).
 *
 * Every statement inside a transaction uses `tx`, never `this.db`: a request that needs a second
 * pool connection while holding one would deadlock the pool under load. Database errors are
 * translated to domain errors OUTSIDE the transaction because a failed statement aborts it.
 */

export { GUEST_HORIZON_DAYS, TRIAL_HORIZON_DAYS };

export interface GuestInput {
  name: string;
  phone: string;
  email?: string | null;
}

export interface CreateBookingInput {
  courtId: string;
  startsAt: Date;
  /** Exactly one of `memberId` / `guest` (the caller validates who may pass which). */
  memberId?: string;
  guest?: GuestInput;
  channel?: Exclude<BookingChannel, 'WEBSITE_TRIAL'>;
  /** `TRIAL` is only used by the public trial-booking route (M-13). */
  kind?: Exclude<BookingKind, 'SOCIAL'>;
  payNow?: { method: PaymentMethod; reference?: string };
  /** The authenticated user performing the action (audit, `created_by`, `received_by`). */
  actorUserId?: string | null;
  /**
   * Runs inside the booking transaction once the booking row exists. Whatever it writes commits
   * or rolls back with the booking (the public trial flow creates its lead here), and a throw
   * rolls the booking back too.
   */
  inTransaction?: (tx: DbExecutor, bookingId: string) => Promise<void>;
}

export interface JoinSocialInput {
  courtId: string;
  startsAt: Date;
  memberId?: string;
  guest?: GuestInput;
  channel?: Exclude<BookingChannel, 'WEBSITE_TRIAL'>;
  actorUserId?: string | null;
}

export interface CancelInput {
  bookingId: string;
  actorUserId: string;
  reason?: string;
  /** Staff-only: waive the cutoff. The caller has already verified `bookings:override`. */
  override?: boolean;
}

export interface CancelResult {
  booking: Booking;
  refund: { amountPaise: number; method: string } | null;
  quotaFreed: boolean;
  late: boolean;
}

export type AuditFn = (event: {
  action: string;
  actor?: string;
  target?: string;
  status?: 'success' | 'failure';
  details?: Record<string, unknown>;
}) => Promise<void>;

export interface BookingServiceOptions {
  timezone: string;
  audit?: AuditFn;
  /** Injectable clock so cutoff and "not in the past" rules are testable. */
  now?: () => Date;
}

export interface BookingListScope {
  /** Restrict to one member (the `/me/bookings` view). */
  memberId?: string;
  scope?: 'upcoming' | 'past';
}

type Tx = DbExecutor;

const bookingColumns = {
  id: bookings.id,
  courtId: courts.id,
  courtName: courts.name,
  courtType: courtTypes.code,
  kind: bookings.kind,
  memberId: bookings.memberId,
  memberCode: members.memberCode,
  memberName: members.fullName,
  guestName: bookings.guestName,
  guestPhone: bookings.guestPhone,
  guestEmail: bookings.guestEmail,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  bookingDate: bookings.bookingDate,
  status: bookings.status,
  cancelledLate: bookings.cancelledLate,
  channel: bookings.channel,
  basePricePaise: bookings.basePricePaise,
  discountPct: bookings.discountPct,
  pricePaise: bookings.pricePaise,
  paymentStatus: bookings.paymentStatus,
  socialSessionId: bookings.socialSessionId,
  createdAt: bookings.createdAt,
};

type BookingJoinRow = {
  id: string;
  courtId: string;
  courtName: string;
  courtType: string;
  kind: BookingKind;
  memberId: string | null;
  memberCode: string | null;
  memberName: string | null;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  startsAt: Date;
  endsAt: Date;
  bookingDate: string;
  status: BookingStatus;
  cancelledLate: boolean;
  channel: BookingChannel;
  basePricePaise: number;
  discountPct: number;
  pricePaise: number;
  paymentStatus: BookingPaymentStatus;
  socialSessionId: string | null;
  createdAt: Date;
};

export function toBooking(row: BookingJoinRow): Booking {
  return {
    id: row.id,
    court: { id: row.courtId, name: row.courtName, type: row.courtType },
    kind: row.kind,
    member: row.memberId ? { id: row.memberId, memberCode: row.memberCode ?? '', fullName: row.memberName ?? '' } : null,
    guest: row.guestName ? { name: row.guestName, phone: row.guestPhone ?? '', email: row.guestEmail } : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    bookingDate: row.bookingDate,
    status: row.status,
    cancelledLate: row.cancelledLate,
    channel: row.channel,
    basePricePaise: row.basePricePaise,
    discountPct: row.discountPct,
    pricePaise: row.pricePaise,
    paymentStatus: row.paymentStatus,
    socialSessionId: row.socialSessionId,
    createdAt: row.createdAt.toISOString(),
  };
}

interface PgErrorInfo {
  code?: string;
  constraint?: string;
}

/**
 * Drizzle 0.45 may wrap the driver error in a `DrizzleQueryError` whose `.cause` is the postgres
 * error, so look at the error and its causes for the SQLSTATE and the violated constraint.
 */
export function pgErrorInfo(error: unknown): PgErrorInfo {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    const code = typeof e.code === 'string' ? e.code : undefined;
    const constraint =
      typeof e.constraint_name === 'string' ? e.constraint_name : typeof e.constraint === 'string' ? e.constraint : undefined;
    if (code && /^[0-9A-Z]{5}$/.test(code)) return { code, constraint };
    current = e.cause;
  }
  return {};
}

/** Translates the constraint violations the booking engine relies on into domain errors. */
export function mapBookingDbError(error: unknown, context: 'booking' | 'social'): unknown {
  if (error instanceof DomainError) return error;
  const { code, constraint } = pgErrorInfo(error);

  if (code === '23P01') {
    if (constraint === 'bookings_member_no_overlap') {
      return new DomainError(
        'MEMBER_DOUBLE_BOOKED',
        409,
        'This member already has an overlapping session on another court.'
      );
    }
    return context === 'social'
      ? new DomainError('SOCIAL_WINDOW', 409, 'An exclusive booking already holds this court-hour.')
      : new DomainError('SLOT_TAKEN', 409, 'That court is already booked for this time.');
  }
  if (code === '23505') {
    if (constraint === 'uq_bookings_social_member') {
      return new DomainError('ALREADY_JOINED', 409, 'This member has already joined this social session.');
    }
    if (constraint === 'uq_bookings_trial_phone') {
      return new DomainError('TRIAL_ALREADY_USED', 409, 'This phone number has already used a trial session.');
    }
  }
  return error;
}

const COUNTED_STATUSES: BookingStatus[] = ['CONFIRMED', 'COMPLETED', 'NO_SHOW'];

export class BookingService {
  private readonly pricing: PricingService;
  private readonly timezone: string;
  private readonly audit: AuditFn | undefined;
  private readonly clock: () => Date;

  constructor(
    private readonly db: DatabaseInstance,
    options: BookingServiceOptions
  ) {
    this.pricing = new PricingService(db);
    this.timezone = options.timezone;
    this.audit = options.audit;
    this.clock = options.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------------------

  async getBooking(id: string, executor: Tx = this.db): Promise<Booking | null> {
    const [row] = await executor
      .select(bookingColumns)
      .from(bookings)
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(courtTypes, eq(courtTypes.id, courts.courtTypeId))
      .leftJoin(members, eq(members.id, bookings.memberId))
      .where(eq(bookings.id, id))
      .limit(1);
    return row ? toBooking(row as BookingJoinRow) : null;
  }

  /**
   * Who owns a booking, for `:self` checks. `ownerUserId` is the login of the booked member (null
   * for guests and members without a login, which therefore never match a self permission).
   */
  async getOwner(bookingId: string): Promise<{ exists: boolean; ownerUserId: string | null }> {
    const [row] = await this.db
      .select({ userId: members.userId })
      .from(bookings)
      .leftJoin(members, eq(members.id, bookings.memberId))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    return { exists: Boolean(row), ownerUserId: row?.userId ?? null };
  }

  /** The member profile behind a login, if any. */
  async findMemberByUserId(userId: string): Promise<{ id: string; userId: string | null } | null> {
    const [row] = await this.db.select({ id: members.id, userId: members.userId }).from(members).where(eq(members.userId, userId)).limit(1);
    return row ?? null;
  }

  async findMember(memberId: string): Promise<{ id: string; userId: string | null } | null> {
    const [row] = await this.db.select({ id: members.id, userId: members.userId }).from(members).where(eq(members.id, memberId)).limit(1);
    return row ?? null;
  }

  async list(query: BookingListQuery, restrict: BookingListScope = {}) {
    const conditions: SQL[] = [];
    const memberId = restrict.memberId ?? query.memberId;
    if (memberId) conditions.push(eq(bookings.memberId, memberId));
    if (query.courtId) conditions.push(eq(bookings.courtId, query.courtId));
    if (query.status) conditions.push(eq(bookings.status, query.status));
    if (query.kind) conditions.push(eq(bookings.kind, query.kind));
    if (query.date) conditions.push(eq(bookings.bookingDate, query.date));
    if (query.from) conditions.push(gte(bookings.bookingDate, query.from));
    if (query.to) conditions.push(lte(bookings.bookingDate, query.to));
    const now = this.clock();
    if (restrict.scope === 'upcoming') {
      conditions.push(gte(bookings.startsAt, now), inArray(bookings.status, ['CONFIRMED']));
    } else if (restrict.scope === 'past') {
      conditions.push(or(lt(bookings.startsAt, now), inArray(bookings.status, ['COMPLETED', 'CANCELLED', 'NO_SHOW']))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(bookings).where(where);
    const order = restrict.scope === 'upcoming' || query.order === 'asc' ? asc(bookings.startsAt) : desc(bookings.startsAt);
    const rows = await this.db
      .select(bookingColumns)
      .from(bookings)
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(courtTypes, eq(courtTypes.id, courts.courtTypeId))
      .leftJoin(members, eq(members.id, bookings.memberId))
      .where(where)
      .orderBy(order, asc(bookings.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    const totalPages = Math.ceil(total / query.limit);
    return {
      data: rows.map((r) => toBooking(r as BookingJoinRow)),
      meta: {
        page: query.page,
        limit: query.limit,
        totalItems: total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPrevPage: query.page > 1,
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Create (BR-01 .. BR-07)
  // ---------------------------------------------------------------------------------------------

  async create(input: CreateBookingInput): Promise<Booking> {
    const kind = input.kind ?? 'STANDARD';
    const channel: BookingChannel = kind === 'TRIAL' ? 'WEBSITE_TRIAL' : (input.channel ?? 'DESK');
    const plan = await this.prepare(input, kind);

    try {
      const bookingId = await this.db.transaction(async (tx) => {
        if (input.memberId) await this.lockAndCheckDailyLimit(tx, input.memberId, plan.bookingDate, plan.entitlements);
        await this.lockCourtDay(tx, input.courtId, plan.bookingDate);

        // Occupancy first: the exclusion constraint is what refuses a double booking.
        const [occupancy] = await tx
          .insert(courtOccupancies)
          .values({
            courtId: input.courtId,
            startsAt: input.startsAt,
            endsAt: plan.endsAt,
            kind: 'BOOKING',
            createdBy: input.actorUserId ?? null,
          })
          .returning({ id: courtOccupancies.id });

        const paying = Boolean(input.payNow) && plan.price.pricePaise > 0;
        const [booking] = await tx
          .insert(bookings)
          .values({
            courtId: input.courtId,
            kind,
            memberId: input.memberId ?? null,
            guestName: input.guest?.name ?? null,
            guestPhone: input.guest?.phone ?? null,
            guestEmail: input.guest?.email ?? null,
            startsAt: input.startsAt,
            endsAt: plan.endsAt,
            bookingDate: plan.bookingDate,
            channel,
            basePricePaise: plan.price.basePricePaise,
            discountPct: plan.price.discountPct,
            pricePaise: plan.price.pricePaise,
            paymentStatus: plan.price.pricePaise === 0 ? 'WAIVED' : paying ? 'PAID' : 'UNPAID',
            createdBy: input.actorUserId ?? null,
          })
          .returning({ id: bookings.id });

        await tx.update(courtOccupancies).set({ bookingId: booking.id }).where(eq(courtOccupancies.id, occupancy.id));

        if (paying && input.payNow) {
          await new PaymentService(tx).record({
            source: 'COURT',
            sourceId: booking.id,
            amountPaise: plan.price.pricePaise,
            method: input.payNow.method,
            memberId: input.memberId ?? null,
            receivedBy: input.actorUserId ?? null,
            reference: input.payNow.reference ?? null,
          });
        }
        if (input.inTransaction) await input.inTransaction(tx, booking.id);
        return booking.id;
      });
      return (await this.getBooking(bookingId))!;
    } catch (error) {
      throw mapBookingDbError(error, 'booking');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Friday social play (BR-10, section 3.3)
  // ---------------------------------------------------------------------------------------------

  async joinSocial(input: JoinSocialInput): Promise<Booking & { socialSession: { capacity: number; joined: number } }> {
    const now = this.clock();
    this.assertValidInstant(input.startsAt);
    if (input.startsAt.getTime() <= now.getTime()) {
      throw new DomainError('INVALID_SLOT_START', 422, 'That time is in the past.');
    }

    const windows = await this.activeSocialWindows();
    const onTheHour = isSlotStart(input.startsAt, this.timezone) && clubMinutesOfDay(input.startsAt, this.timezone) % 60 === 0;
    if (!onTheHour || !isInSocialWindow(input.startsAt, windows, this.timezone)) {
      throw new DomainError('NOT_A_SOCIAL_SLOT', 422, 'Social play runs on the hour inside a social window.');
    }

    const court = await this.loadCourt(input.courtId);
    const bookingDate = clubDateOf(input.startsAt, this.timezone);
    const entitlements = await this.resolveParticipant(input, bookingDate, GUEST_HORIZON_DAYS, now);
    const price = priceFor({
      courtType: court.type,
      plan: entitlements.isMember ? { courtDiscountPct: entitlements.courtDiscountPct } : null,
      kind: 'SOCIAL',
    });
    const endsAt = new Date(input.startsAt.getTime() + SESSION_MINUTES * 60_000);

    try {
      const result = await this.db.transaction(async (tx) => {
        // Same lock order as create(): member-and-day first, then court rows.
        if (input.memberId) await this.lockAndCheckDailyLimit(tx, input.memberId, bookingDate, entitlements);
        await this.lockCourtDay(tx, input.courtId, bookingDate);

        const inserted = await tx
          .insert(socialSessions)
          .values({ courtId: input.courtId, startsAt: input.startsAt, endsAt, capacity: court.type.socialCapacity })
          .onConflictDoNothing({ target: [socialSessions.courtId, socialSessions.startsAt] })
          .returning({ id: socialSessions.id });

        if (inserted.length > 0) {
          // First joiner: the whole court-hour is now held by one SOCIAL occupancy.
          await tx.insert(courtOccupancies).values({
            courtId: input.courtId,
            startsAt: input.startsAt,
            endsAt,
            kind: 'SOCIAL',
            socialSessionId: inserted[0].id,
            createdBy: input.actorUserId ?? null,
          });
        }

        // Lock the session row so the capacity count below is exact under concurrency.
        const [session] = await tx
          .select({ id: socialSessions.id, capacity: socialSessions.capacity, status: socialSessions.status })
          .from(socialSessions)
          .where(and(eq(socialSessions.courtId, input.courtId), eq(socialSessions.startsAt, input.startsAt)))
          .for('update')
          .limit(1);
        if (!session || session.status !== 'OPEN') {
          throw new DomainError('NOT_A_SOCIAL_SLOT', 422, 'This social session is not open.');
        }

        const [{ joined }] = await tx
          .select({ joined: sql<number>`count(*)::int` })
          .from(bookings)
          .where(and(eq(bookings.socialSessionId, session.id), inArray(bookings.status, COUNTED_STATUSES)));
        if (joined >= session.capacity) {
          throw new DomainError('SOCIAL_FULL', 409, 'This social session is full.');
        }

        if (input.memberId) {
          const [already] = await tx
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.socialSessionId, session.id),
                eq(bookings.memberId, input.memberId),
                inArray(bookings.status, COUNTED_STATUSES)
              )
            )
            .limit(1);
          if (already) throw new DomainError('ALREADY_JOINED', 409, 'This member has already joined this social session.');
        }

        const [booking] = await tx
          .insert(bookings)
          .values({
            courtId: input.courtId,
            kind: 'SOCIAL',
            memberId: input.memberId ?? null,
            guestName: input.guest?.name ?? null,
            guestPhone: input.guest?.phone ?? null,
            guestEmail: input.guest?.email ?? null,
            socialSessionId: session.id,
            startsAt: input.startsAt,
            endsAt,
            bookingDate,
            channel: input.channel ?? 'ONLINE',
            basePricePaise: price.basePricePaise,
            discountPct: price.discountPct,
            pricePaise: price.pricePaise,
            paymentStatus: price.pricePaise === 0 ? 'WAIVED' : 'UNPAID',
            createdBy: input.actorUserId ?? null,
          })
          .returning({ id: bookings.id });

        return { bookingId: booking.id, capacity: session.capacity, joined: joined + 1 };
      });

      const booking = (await this.getBooking(result.bookingId))!;
      return { ...booking, socialSession: { capacity: result.capacity, joined: result.joined } };
    } catch (error) {
      throw mapBookingDbError(error, 'social');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Cancel (BR-08)
  // ---------------------------------------------------------------------------------------------

  async cancel(input: CancelInput): Promise<CancelResult> {
    const now = this.clock();
    const cutoffHours = await getCancelCutoffHours(this.db);

    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for('update').limit(1);
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Booking not found.');
      if (row.status !== 'CONFIRMED') {
        throw new DomainError('CANCEL_NOT_ALLOWED', 409, `A ${row.status.toLowerCase().replace('_', '-')} booking cannot be cancelled.`);
      }
      if (row.startsAt.getTime() <= now.getTime()) {
        throw new DomainError('CANCEL_NOT_ALLOWED', 409, 'A session that has already started cannot be cancelled.');
      }

      const withinCutoff = row.startsAt.getTime() - now.getTime() < cutoffHours * 3_600_000;
      const late = withinCutoff && !input.override;

      // The court is always freed (even a late cancel lets someone else play). Social
      // participants share one session occupancy that stays while the session exists.
      if (!row.socialSessionId) {
        await tx.delete(courtOccupancies).where(eq(courtOccupancies.bookingId, row.id));
      }

      let refund: CancelResult['refund'] = null;
      let paymentStatus: BookingPaymentStatus = row.paymentStatus;
      if (!late && row.paymentStatus === 'PAID') {
        const payment = new PaymentService(tx);
        const net = await payment.sumPaid('COURT', row.id);
        if (net > 0) {
          const [original] = await tx
            .select({ method: payments.method })
            .from(payments)
            .where(and(eq(payments.source, 'COURT'), eq(payments.sourceId, row.id), eq(payments.kind, 'PAYMENT')))
            .orderBy(desc(payments.paidAt))
            .limit(1);
          const method = original?.method ?? 'CASH';
          await payment.refund({
            source: 'COURT',
            sourceId: row.id,
            amountPaise: net,
            method,
            memberId: row.memberId,
            receivedBy: input.actorUserId,
          });
          refund = { amountPaise: net, method };
          paymentStatus = 'REFUNDED';
        }
      }

      await tx
        .update(bookings)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledLate: late,
          cancelReason: input.reason ?? null,
          paymentStatus,
          updatedAt: now,
        })
        .where(eq(bookings.id, row.id));

      return { refund, late };
    });

    const booking = (await this.getBooking(input.bookingId))!;
    await this.audit?.({
      action: input.override ? 'booking.cancel.override' : 'booking.cancel',
      actor: input.actorUserId,
      target: input.bookingId,
      details: {
        late: outcome.late,
        override: Boolean(input.override),
        reason: input.reason ?? null,
        refundPaise: outcome.refund?.amountPaise ?? 0,
        memberId: booking.member?.id ?? null,
      },
    });
    return { booking, refund: outcome.refund, quotaFreed: !outcome.late, late: outcome.late };
  }

  // ---------------------------------------------------------------------------------------------
  // Pay, no-show, complete
  // ---------------------------------------------------------------------------------------------

  async pay(input: {
    bookingId: string;
    method: PaymentMethod;
    reference?: string;
    actorUserId: string;
  }): Promise<{ booking: Booking; payment: { id: string; amountPaise: number; method: PaymentMethod; paidAt: string } }> {
    const payment = await this.db.transaction(async (tx) => {
      // Guarded transition: only one concurrent payer can flip UNPAID -> PAID.
      const [row] = await tx
        .update(bookings)
        .set({ paymentStatus: 'PAID', updatedAt: this.clock() })
        .where(
          and(eq(bookings.id, input.bookingId), eq(bookings.paymentStatus, 'UNPAID'), inArray(bookings.status, ['CONFIRMED', 'COMPLETED']))
        )
        .returning({ id: bookings.id, memberId: bookings.memberId, pricePaise: bookings.pricePaise });
      if (!row) {
        const [existing] = await tx
          .select({ status: bookings.status, paymentStatus: bookings.paymentStatus })
          .from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .limit(1);
        if (!existing) throw new DomainError('NOT_FOUND', 404, 'Booking not found.');
        if (existing.paymentStatus !== 'UNPAID') {
          throw new DomainError('ALREADY_PAID', 409, `This booking is already ${existing.paymentStatus.toLowerCase()}.`);
        }
        throw new DomainError('BOOKING_STATE_INVALID', 409, `A ${existing.status.toLowerCase().replace('_', '-')} booking cannot be paid.`);
      }
      return new PaymentService(tx).record({
        source: 'COURT',
        sourceId: row.id,
        amountPaise: row.pricePaise,
        method: input.method,
        memberId: row.memberId,
        receivedBy: input.actorUserId,
        reference: input.reference ?? null,
      });
    });

    return {
      booking: (await this.getBooking(input.bookingId))!,
      payment: { id: payment.id, amountPaise: payment.amountPaise, method: payment.method, paidAt: payment.paidAt.toISOString() },
    };
  }

  async markNoShow(bookingId: string): Promise<Booking> {
    const now = this.clock();
    return this.transition(bookingId, 'NO_SHOW', (startsAt) => {
      if (startsAt.getTime() > now.getTime()) {
        throw new DomainError('BOOKING_STATE_INVALID', 409, 'A session that has not started yet cannot be a no-show.');
      }
    });
  }

  async complete(bookingId: string): Promise<Booking> {
    return this.transition(bookingId, 'COMPLETED');
  }

  private async transition(bookingId: string, to: 'NO_SHOW' | 'COMPLETED', guard?: (startsAt: Date) => void): Promise<Booking> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update').limit(1);
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Booking not found.');
      if (row.status !== 'CONFIRMED') {
        throw new DomainError('BOOKING_STATE_INVALID', 409, `A ${row.status.toLowerCase().replace('_', '-')} booking cannot be changed.`);
      }
      guard?.(row.startsAt);
      await tx.update(bookings).set({ status: to, updatedAt: this.clock() }).where(eq(bookings.id, bookingId));
    });
    return (await this.getBooking(bookingId))!;
  }

  // ---------------------------------------------------------------------------------------------
  // Shared steps
  // ---------------------------------------------------------------------------------------------

  private assertValidInstant(startsAt: Date): void {
    if (Number.isNaN(startsAt.getTime())) {
      throw new DomainError('INVALID_SLOT_START', 422, 'startsAt is not a valid time.');
    }
  }

  private async loadCourt(courtId: string) {
    const [row] = await this.db
      .select({
        id: courts.id,
        name: courts.name,
        isActive: courts.isActive,
        typeActive: courtTypes.isActive,
        baseRatePaise: courtTypes.baseRatePaise,
        socialFeePaise: courtTypes.socialFeePaise,
        trialFeePaise: courtTypes.trialFeePaise,
        socialCapacity: courtTypes.socialCapacity,
      })
      .from(courts)
      .innerJoin(courtTypes, eq(courtTypes.id, courts.courtTypeId))
      .where(eq(courts.id, courtId))
      .limit(1);
    if (!row || !row.isActive || !row.typeActive) {
      throw new DomainError('COURT_NOT_FOUND', 404, 'Court not found.');
    }
    return {
      id: row.id,
      name: row.name,
      type: {
        baseRatePaise: row.baseRatePaise,
        socialFeePaise: row.socialFeePaise,
        trialFeePaise: row.trialFeePaise,
        socialCapacity: row.socialCapacity,
      },
    };
  }

  private async activeSocialWindows() {
    return this.db
      .select({ weekday: socialWindows.weekday, startsTime: socialWindows.startsTime, endsTime: socialWindows.endsTime })
      .from(socialWindows)
      .where(eq(socialWindows.isActive, true));
  }

  /**
   * Resolves the participant's entitlements and enforces the membership and horizon rules shared
   * by exclusive and social bookings (BR-06, BR-07). Guests are priced as walk-ins.
   */
  private async resolveParticipant(
    input: { memberId?: string; guest?: GuestInput },
    bookingDate: string,
    guestHorizonDays: number,
    now: Date
  ): Promise<Entitlements> {
    if (!input.memberId === !input.guest) {
      throw new DomainError('VALIDATION_ERROR', 400, 'Provide exactly one of memberId or guest.');
    }

    let entitlements: Entitlements;
    if (input.memberId) {
      const member = await this.findMember(input.memberId);
      if (!member) throw new DomainError('MEMBER_NOT_FOUND', 404, 'Member not found.');
      entitlements = await this.pricing.resolveEntitlements(input.memberId, bookingDate);
      if (entitlements.membershipExpiresBeforeDate) {
        throw new DomainError(
          'MEMBERSHIP_EXPIRES_BEFORE_SLOT',
          422,
          'Your membership ends before this session date. Renew first to book at the member price.'
        );
      }
    } else {
      entitlements = walkInEntitlements();
      entitlements.bookingHorizonDays = guestHorizonDays;
    }

    const today = clubDateOf(now, this.timezone);
    if (daysBetween(today, bookingDate) > entitlements.bookingHorizonDays) {
      throw new DomainError(
        'BEYOND_BOOKING_HORIZON',
        422,
        `Bookings can be made at most ${entitlements.bookingHorizonDays} days ahead.`
      );
    }
    return entitlements;
  }

  /** All reads and rule checks that do not need the transaction (BR-01, BR-02, BR-05, BR-06, BR-07). */
  private async prepare(input: CreateBookingInput, kind: 'STANDARD' | 'TRIAL') {
    const now = this.clock();
    this.assertValidInstant(input.startsAt);
    if (!isSlotStart(input.startsAt, this.timezone)) {
      throw new DomainError('INVALID_SLOT_START', 422, 'Sessions start on the hour or half hour.');
    }
    if (input.startsAt.getTime() <= now.getTime()) {
      throw new DomainError('INVALID_SLOT_START', 422, 'That time is in the past.');
    }
    const hours = await getClubHours(this.db);
    if (!isInOpeningHours(input.startsAt, hours, this.timezone)) {
      throw new DomainError('INVALID_SLOT_START', 422, `The club is open ${hours.open} to ${hours.close}; sessions must end by closing.`);
    }
    if (kind === 'TRIAL' && input.memberId) {
      throw new DomainError('VALIDATION_ERROR', 400, 'Trial bookings are for guests.');
    }

    const court = await this.loadCourt(input.courtId);
    const bookingDate = clubDateOf(input.startsAt, this.timezone);

    // BR-10: exclusive bookings are refused inside a social window.
    if (isInSocialWindow(input.startsAt, await this.activeSocialWindows(), this.timezone)) {
      throw new DomainError('SOCIAL_WINDOW', 409, 'This court-hour is a Friday social session. Join it instead.');
    }

    const entitlements = await this.resolveParticipant(
      input,
      bookingDate,
      kind === 'TRIAL' ? TRIAL_HORIZON_DAYS : GUEST_HORIZON_DAYS,
      now
    );
    const price = priceFor({
      courtType: court.type,
      plan: entitlements.isMember ? { courtDiscountPct: entitlements.courtDiscountPct } : null,
      kind,
    });
    return {
      court,
      bookingDate,
      entitlements,
      price,
      endsAt: new Date(input.startsAt.getTime() + SESSION_MINUTES * 60_000),
    };
  }

  /**
   * Serialises writers of one court's day. Two concurrent inserts into an EXCLUDE-constrained
   * table each find the other's uncommitted row and wait for it, which PostgreSQL resolves as a
   * deadlock (40P01) after `deadlock_timeout` instead of the clean 23P01. Taking this lock first
   * makes the losers queue and then fail fast with 23P01. Lock order is always member-day, then
   * court-day, so the two kinds of lock can never form a cycle.
   */
  private async lockCourtDay(tx: Tx, courtId: string, bookingDate: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`court:${courtId}:${bookingDate}`}, 0))`);
  }

  /**
   * BR-04: serialise this member's bookings for the club day with a transaction-scoped advisory
   * lock, then count what already holds quota (late cancellations keep theirs, BR-08).
   */
  private async lockAndCheckDailyLimit(tx: Tx, memberId: string, bookingDate: string, entitlements: Entitlements): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${memberId}:${bookingDate}`}, 0))`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.memberId, memberId),
          eq(bookings.bookingDate, bookingDate),
          or(inArray(bookings.status, COUNTED_STATUSES), and(eq(bookings.status, 'CANCELLED'), eq(bookings.cancelledLate, true)))
        )
      );
    if (count >= entitlements.maxBookingsPerDay) {
      throw new DomainError(
        'DAILY_LIMIT_REACHED',
        422,
        `You already have ${entitlements.maxBookingsPerDay} bookings on this day.`
      );
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Demo tool: the double-booking proof shown on stage (disabled in production by the route)
  // ---------------------------------------------------------------------------------------------

  /**
   * Fires `attempts` simultaneous bookings for one court-hour, each by its own throwaway member,
   * then deletes every row it created. Returns how the database arbitrated the race.
   */
  async runRace(input: { courtId: string; startsAt: Date; attempts: number; actorUserId?: string | null }) {
    const started = Date.now();
    const tag = randomUUID().slice(0, 8);
    const created = await this.db
      .insert(members)
      .values(
        Array.from({ length: input.attempts }, (_, i) => ({
          memberCode: `RC${tag}${String(i).padStart(2, '0')}`,
          fullName: `Race Test ${i + 1}`,
          phone: `+9100000${tag.slice(0, 4)}${String(i).padStart(2, '0')}`.slice(0, 20),
        }))
      )
      .returning({ id: members.id });
    const memberIds = created.map((m) => m.id);

    try {
      const results = await Promise.allSettled(
        memberIds.map((memberId) =>
          this.create({ courtId: input.courtId, startsAt: input.startsAt, memberId, channel: 'DESK', actorUserId: input.actorUserId })
        )
      );
      let confirmed = 0;
      let slotTaken = 0;
      let other = 0;
      let bookingId: string | null = null;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          confirmed += 1;
          bookingId = r.value.id;
        } else if (r.reason instanceof DomainError && r.reason.code === 'SLOT_TAKEN') {
          slotTaken += 1;
        } else {
          other += 1;
        }
      }
      return { attempts: input.attempts, confirmed, slotTaken, other, durationMs: Date.now() - started, bookingId };
    } finally {
      await this.db.delete(bookings).where(inArray(bookings.memberId, memberIds)); // occupancies cascade
      await this.db.delete(members).where(inArray(members.id, memberIds));
    }
  }
}
