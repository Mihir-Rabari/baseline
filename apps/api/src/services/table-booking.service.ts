import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import {
  barTableBookings,
  barTables,
  members,
  type DatabaseInstance,
  type TableBookingStatus,
} from '@packages/db';
import { getEnv } from '@packages/config/env';
import type {
  CreateTableBookingRequest,
  TableBooking,
  TableBookingQuery,
  UpdateTableBookingRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { addDays, startOfClubDay } from './time.js';

type Tx = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];

/** BOOKED and SEATED rows hold the table; everything else is history. */
const HOLDING: TableBookingStatus[] = ['BOOKED', 'SEATED'];

/** What a booking may become next. Closed bookings (COMPLETED, CANCELLED, NO_SHOW) are final. */
const TRANSITIONS: Record<TableBookingStatus, TableBookingStatus[]> = {
  BOOKED: ['SEATED', 'CANCELLED', 'NO_SHOW'],
  SEATED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export interface TableBookingServiceOptions {
  timeZone?: string;
  now?: () => Date;
}

/** Reservations of bar tables, with overlap prevention per table. */
export class TableBookingService {
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseInstance,
    options: TableBookingServiceOptions = {}
  ) {
    this.timeZone = options.timeZone ?? getEnv().CLUB_TIMEZONE;
    this.now = options.now ?? (() => new Date());
  }

  private select() {
    return this.db
      .select({ row: barTableBookings, tableName: barTables.name })
      .from(barTableBookings)
      .innerJoin(barTables, eq(barTables.id, barTableBookings.tableId));
  }

  private dto(row: typeof barTableBookings.$inferSelect, tableName: string): TableBooking {
    return {
      id: row.id,
      tableId: row.tableId,
      tableName,
      guestName: row.guestName,
      memberId: row.memberId,
      partySize: row.partySize,
      notes: row.notes,
      status: row.status,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    };
  }

  /** Bookings that touch `[date, date + days)` in club time, oldest first. */
  async list(query: TableBookingQuery): Promise<TableBooking[]> {
    const from = startOfClubDay(query.date, this.timeZone);
    const to = startOfClubDay(addDays(query.date, query.days), this.timeZone);
    const filters = [lt(barTableBookings.startsAt, to), gt(barTableBookings.endsAt, from)];
    if (query.tableId) filters.push(eq(barTableBookings.tableId, query.tableId));
    if (query.includeClosed !== 'true') filters.push(inArray(barTableBookings.status, [...HOLDING, 'COMPLETED']));
    const rows = await this.select()
      .where(and(...filters))
      .orderBy(asc(barTableBookings.startsAt), asc(barTables.name));
    return rows.map((r) => this.dto(r.row, r.tableName));
  }

  async get(id: string): Promise<TableBooking> {
    const [r] = await this.select().where(eq(barTableBookings.id, id)).limit(1);
    if (!r) throw new DomainError('NOT_FOUND', 404, 'Booking not found.');
    return this.dto(r.row, r.tableName);
  }

  async create(input: CreateTableBookingRequest, actorUserId: string | null): Promise<TableBooking> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    this.assertNotPast(endsAt);
    const id = await this.db.transaction(async (tx) => {
      await this.lockUsableTable(tx, input.tableId);
      if (input.memberId) {
        const [member] = await tx.select({ id: members.id }).from(members).where(eq(members.id, input.memberId)).limit(1);
        if (!member) throw new DomainError('NOT_FOUND', 404, 'Member not found.');
      }
      await this.assertFree(tx, input.tableId, startsAt, endsAt);
      const [row] = await tx
        .insert(barTableBookings)
        .values({
          tableId: input.tableId,
          guestName: input.guestName,
          memberId: input.memberId ?? null,
          partySize: input.partySize,
          notes: input.notes ?? null,
          startsAt,
          endsAt,
          createdBy: actorUserId,
        })
        .returning({ id: barTableBookings.id });
      return row.id;
    });
    return this.get(id);
  }

  /** Move, resize, edit details or advance the status. Overlaps are re-checked when time or table changes. */
  async update(id: string, patch: UpdateTableBookingRequest): Promise<TableBooking> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(barTableBookings).where(eq(barTableBookings.id, id)).for('update');
      if (!current) throw new DomainError('NOT_FOUND', 404, 'Booking not found.');
      if (TRANSITIONS[current.status].length === 0) {
        throw new DomainError('BOOKING_CLOSED', 409, `This booking is ${current.status.toLowerCase().replace('_', ' ')} and can no longer change.`);
      }
      if (patch.status !== undefined && patch.status !== current.status && !TRANSITIONS[current.status].includes(patch.status)) {
        throw new DomainError('INVALID_BOOKING_STATUS', 409, `A ${current.status.toLowerCase()} booking cannot become ${patch.status.toLowerCase().replace('_', ' ')}.`);
      }
      const next = {
        tableId: patch.tableId ?? current.tableId,
        startsAt: patch.startsAt ? new Date(patch.startsAt) : current.startsAt,
        endsAt: patch.endsAt ? new Date(patch.endsAt) : current.endsAt,
        status: patch.status ?? current.status,
      };
      if (next.endsAt.getTime() <= next.startsAt.getTime()) {
        throw new DomainError('VALIDATION_ERROR', 422, 'The booking must end after it starts.');
      }
      if (next.endsAt.getTime() - next.startsAt.getTime() > 12 * 3_600_000) {
        throw new DomainError('VALIDATION_ERROR', 422, 'A booking can last at most 12 hours.');
      }
      const moved =
        next.tableId !== current.tableId ||
        next.startsAt.getTime() !== current.startsAt.getTime() ||
        next.endsAt.getTime() !== current.endsAt.getTime();
      if (moved) this.assertNotPast(next.endsAt);
      if (HOLDING.includes(next.status) && (moved || !HOLDING.includes(current.status))) {
        await this.lockUsableTable(tx, next.tableId);
        await this.assertFree(tx, next.tableId, next.startsAt, next.endsAt, id);
      }
      await tx
        .update(barTableBookings)
        .set({
          ...next,
          ...(patch.guestName !== undefined && { guestName: patch.guestName }),
          ...(patch.partySize !== undefined && { partySize: patch.partySize }),
          ...(patch.notes !== undefined && { notes: patch.notes }),
          updatedAt: new Date(),
        })
        .where(eq(barTableBookings.id, id));
    });
    return this.get(id);
  }

  /** Cancels (never deletes) so the history and reports stay intact. */
  async cancel(id: string): Promise<TableBooking> {
    return this.update(id, { status: 'CANCELLED' });
  }

  private assertNotPast(endsAt: Date) {
    if (endsAt.getTime() <= this.now().getTime()) {
      throw new DomainError('BOOKING_IN_PAST', 422, 'That time has already passed. Choose a later time.');
    }
  }

  /** Serialises writers on one table, so two requests cannot both pass the overlap check. */
  private async lockUsableTable(tx: Tx, tableId: string) {
    const [table] = await tx.select().from(barTables).where(eq(barTables.id, tableId)).for('update');
    if (!table) throw new DomainError('NOT_FOUND', 404, 'Table not found.');
    if (!table.isActive) throw new DomainError('TABLE_UNAVAILABLE', 422, `Table ${table.name} is switched off. Choose another.`);
  }

  private async assertFree(tx: Tx, tableId: string, startsAt: Date, endsAt: Date, exceptId?: string) {
    const filters = [
      eq(barTableBookings.tableId, tableId),
      inArray(barTableBookings.status, HOLDING),
      lt(barTableBookings.startsAt, endsAt),
      gt(barTableBookings.endsAt, startsAt),
    ];
    if (exceptId) filters.push(ne(barTableBookings.id, exceptId));
    const [clash] = await tx
      .select({ id: barTableBookings.id, guestName: barTableBookings.guestName, startsAt: barTableBookings.startsAt, endsAt: barTableBookings.endsAt })
      .from(barTableBookings)
      .where(and(...filters))
      .orderBy(asc(barTableBookings.startsAt))
      .limit(1);
    if (clash) {
      throw new DomainError('TABLE_BOOKING_CONFLICT', 409, `That table is already booked for ${clash.guestName} from ${clash.startsAt.toISOString()} to ${clash.endsAt.toISOString()}.`, [
        { field: 'conflictingBookingId', message: clash.id },
      ]);
    }
  }
}
