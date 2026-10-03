import { and, asc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { employees, staffShifts } from '@packages/db';
import type { CreateShiftRequest, Shift, ShiftListQuery, ShiftStatus } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { EXCLUSION_VIOLATION, pgCode } from '../lib/db-errors.js';
import type { DbExecutor } from './db-types.js';
import { dayRange } from './time.js';

/** Staff may clock in this long before the shift starts. */
export const CLOCK_IN_EARLY_MS = 30 * 60 * 1000;
/** Upper bound on one roster response. */
const MAX_ROWS = 500;

type ShiftRow = typeof staffShifts.$inferSelect;

export function shiftStatus(row: Pick<ShiftRow, 'clockInAt' | 'clockOutAt' | 'endsAt'>, now: Date): ShiftStatus {
  if (row.clockOutAt) return 'DONE';
  if (row.clockInAt) return 'ON_SHIFT';
  return row.endsAt.getTime() <= now.getTime() ? 'MISSED' : 'SCHEDULED';
}

/** Rostering and clocking. An employee's shifts never overlap (database exclusion constraint). */
export class ShiftService {
  constructor(
    private readonly db: DbExecutor,
    private readonly timezone: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private toShift(row: ShiftRow, fullName: string): Shift {
    return {
      id: row.id,
      employee: { id: row.employeeId, fullName },
      roleLabel: row.roleLabel,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      clockInAt: row.clockInAt ? row.clockInAt.toISOString() : null,
      clockOutAt: row.clockOutAt ? row.clockOutAt.toISOString() : null,
      status: shiftStatus(row, this.now()),
    };
  }

  /** The employee record linked to a login, or null for owners and members without one. */
  async employeeIdForUser(userId: string): Promise<string | null> {
    const [row] = await this.db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).limit(1);
    return row?.id ?? null;
  }

  async get(id: string): Promise<Shift | null> {
    const [row] = await this.db
      .select({ shift: staffShifts, fullName: employees.fullName })
      .from(staffShifts)
      .innerJoin(employees, eq(employees.id, staffShifts.employeeId))
      .where(eq(staffShifts.id, id))
      .limit(1);
    return row ? this.toShift(row.shift, row.fullName) : null;
  }

  /**
   * A roster viewer (owner, front desk) sees everyone and may filter by employee. Anyone else sees only
   * the shifts of the employee linked to their login, and nothing if they have none.
   */
  async list(query: ShiftListQuery, viewer: { roster: boolean; employeeId: string | null }): Promise<Shift[]> {
    if (!viewer.roster && !viewer.employeeId) return [];
    if (!viewer.roster && query.employeeId && query.employeeId !== viewer.employeeId) return [];
    const employeeId = viewer.roster ? query.employeeId : viewer.employeeId;
    const rows = await this.db
      .select({ shift: staffShifts, fullName: employees.fullName })
      .from(staffShifts)
      .innerJoin(employees, eq(employees.id, staffShifts.employeeId))
      .where(
        and(
          employeeId ? eq(staffShifts.employeeId, employeeId) : undefined,
          query.from ? gte(staffShifts.startsAt, dayRange(query.from, this.timezone).start) : undefined,
          query.to ? lt(staffShifts.startsAt, dayRange(query.to, this.timezone).end) : undefined
        )
      )
      .orderBy(asc(staffShifts.startsAt), asc(staffShifts.id))
      .limit(MAX_ROWS);
    return rows.map((row) => this.toShift(row.shift, row.fullName));
  }

  async create(input: CreateShiftRequest): Promise<Shift> {
    const [employee] = await this.db
      .select({ id: employees.id, fullName: employees.fullName, status: employees.status })
      .from(employees)
      .where(eq(employees.id, input.employeeId))
      .limit(1);
    if (!employee) throw new DomainError('NOT_FOUND', 404, 'Employee not found.');
    if (employee.status !== 'ACTIVE') throw new DomainError('EMPLOYEE_INACTIVE', 409, 'This employee is not active.');
    try {
      const [row] = await this.db
        .insert(staffShifts)
        .values({
          employeeId: employee.id,
          roleLabel: input.roleLabel as ShiftRow['roleLabel'],
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
        })
        .returning();
      return this.toShift(row, employee.fullName);
    } catch (error) {
      if (pgCode(error) === EXCLUSION_VIOLATION) {
        throw new DomainError('SHIFT_OVERLAP', 409, 'This employee already has a shift in that time.');
      }
      throw error;
    }
  }

  /** A shift someone has already clocked into is history (payments point at it) and cannot be deleted. */
  async delete(id: string): Promise<void> {
    const [row] = await this.db.select({ id: staffShifts.id, clockInAt: staffShifts.clockInAt }).from(staffShifts).where(eq(staffShifts.id, id)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Shift not found.');
    if (row.clockInAt) throw new DomainError('SHIFT_STARTED', 409, 'This shift has already been clocked into and cannot be deleted.');
    const removed = await this.db
      .delete(staffShifts)
      .where(and(eq(staffShifts.id, id), isNull(staffShifts.clockInAt)))
      .returning({ id: staffShifts.id });
    if (!removed.length) throw new DomainError('SHIFT_STARTED', 409, 'This shift has already been clocked into and cannot be deleted.');
  }

  /** Looks the shift up and checks it belongs to the caller; another employee's shift is 403. */
  private async ownShift(shiftId: string, employeeId: string | null): Promise<ShiftRow> {
    const [row] = await this.db.select().from(staffShifts).where(eq(staffShifts.id, shiftId)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Shift not found.');
    if (!employeeId || row.employeeId !== employeeId) throw new DomainError('FORBIDDEN', 403, 'You can only clock your own shifts.');
    return row;
  }

  async clockIn(shiftId: string, employeeId: string | null): Promise<Shift> {
    const shift = await this.ownShift(shiftId, employeeId);
    const now = this.now();
    if (shift.clockOutAt) throw new DomainError('ALREADY_CLOCKED_OUT', 409, 'This shift is already finished.');
    if (shift.clockInAt) throw new DomainError('ALREADY_CLOCKED_IN', 409, 'You are already clocked in to this shift.');
    if (shift.endsAt.getTime() <= now.getTime()) throw new DomainError('SHIFT_ENDED', 409, 'This shift has already ended.');
    if (shift.startsAt.getTime() - now.getTime() > CLOCK_IN_EARLY_MS) {
      throw new DomainError('TOO_EARLY', 409, 'You can clock in up to 30 minutes before the shift starts.');
    }
    const [open] = await this.db
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(and(eq(staffShifts.employeeId, shift.employeeId), isNotNull(staffShifts.clockInAt), isNull(staffShifts.clockOutAt)))
      .limit(1);
    if (open) throw new DomainError('ALREADY_ON_SHIFT', 409, 'Clock out of your current shift first.');
    // The predicate makes a double tap a no-op instead of overwriting the first clock-in time.
    const updated = await this.db
      .update(staffShifts)
      .set({ clockInAt: now })
      .where(and(eq(staffShifts.id, shiftId), isNull(staffShifts.clockInAt)))
      .returning({ id: staffShifts.id });
    if (!updated.length) throw new DomainError('ALREADY_CLOCKED_IN', 409, 'You are already clocked in to this shift.');
    return (await this.get(shiftId))!;
  }

  async clockOut(shiftId: string, employeeId: string | null): Promise<Shift> {
    const shift = await this.ownShift(shiftId, employeeId);
    if (shift.clockOutAt) throw new DomainError('ALREADY_CLOCKED_OUT', 409, 'You are already clocked out of this shift.');
    if (!shift.clockInAt) throw new DomainError('NOT_CLOCKED_IN', 409, 'You have not clocked in to this shift.');
    const updated = await this.db
      .update(staffShifts)
      .set({ clockOutAt: this.now() })
      .where(and(eq(staffShifts.id, shiftId), isNotNull(staffShifts.clockInAt), isNull(staffShifts.clockOutAt)))
      .returning({ id: staffShifts.id });
    if (!updated.length) throw new DomainError('ALREADY_CLOCKED_OUT', 409, 'You are already clocked out of this shift.');
    return (await this.get(shiftId))!;
  }

  /** The shift being worked, or else the one that can be clocked into right now, or null. */
  async current(employeeId: string | null): Promise<Shift | null> {
    if (!employeeId) return null;
    const now = this.now();
    const [open] = await this.db
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(and(eq(staffShifts.employeeId, employeeId), isNotNull(staffShifts.clockInAt), isNull(staffShifts.clockOutAt)))
      .orderBy(sql`${staffShifts.clockInAt} desc`)
      .limit(1);
    if (open) return this.get(open.id);
    const [next] = await this.db
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.employeeId, employeeId),
          isNull(staffShifts.clockInAt),
          lt(staffShifts.startsAt, new Date(now.getTime() + CLOCK_IN_EARLY_MS + 1)),
          sql`${staffShifts.endsAt} > ${now.toISOString()}::timestamptz`
        )
      )
      .orderBy(asc(staffShifts.startsAt))
      .limit(1);
    return next ? this.get(next.id) : null;
  }
}

