import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, gte, ne, or } from 'drizzle-orm';
import { employees, leaveRequests, shiftSwaps, staffShifts } from '@packages/db';
import type {
  Colleague,
  CreateShiftSwapRequest,
  Shift,
  ShiftSwap,
  ShiftSwapDecisionRequest,
  ShiftSwapListQuery,
  ShiftSwapResponseRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { EXCLUSION_VIOLATION, UNIQUE_VIOLATION, pgCode } from '../lib/db-errors.js';
import type { DbExecutor } from './db-types.js';
import { NotificationService } from './notification.service.js';
import { clubDateOf } from './time.js';

type SwapRow = typeof shiftSwaps.$inferSelect;
type ShiftRow = typeof staffShifts.$inferSelect;

/** The owner is told about every swap the colleague has agreed to. */
const REVIEW_ROLES = ['OWNER'];
const OPEN: SwapRow['status'][] = ['PENDING', 'ACCEPTED'];

/**
 * Shift swaps. A staff member offers one of their upcoming shifts to a colleague (optionally for one of
 * the colleague's); the colleague accepts or declines; the owner approves or overrides. Only approval
 * moves shifts, in one transaction: if either move fails (for example it would double-book someone) none
 * of it happens.
 */
export class ShiftSwapService {
  constructor(
    private readonly db: DbExecutor,
    private readonly timezone: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ------------------------------------------------------------------ reading

  private async dtos(rows: SwapRow[], viewerId: string | null = null): Promise<ShiftSwap[]> {
    if (!rows.length) return [];
    const shiftIds = [...new Set(rows.flatMap((r) => [r.shiftId, r.requestedShiftId]).filter((id): id is string => Boolean(id)))];
    const employeeIds = [...new Set(rows.flatMap((r) => [r.proposerEmployeeId, r.targetEmployeeId]))];
    const [shiftRows, employeeRows] = await Promise.all([
      this.db.select().from(staffShifts).where(inArray(staffShifts.id, shiftIds)),
      this.db.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(inArray(employees.id, employeeIds)),
    ]);
    const shiftById = new Map(shiftRows.map((s) => [s.id, s]));
    const nameById = new Map(employeeRows.map((e) => [e.id, e.fullName]));
    const shiftDto = (id: string) => {
      const s = shiftById.get(id)!;
      return { id: s.id, roleLabel: s.roleLabel, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() };
    };
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      role: viewerId === r.proposerEmployeeId ? 'PROPOSER' : viewerId === r.targetEmployeeId ? 'TARGET' : null,
      shift: shiftDto(r.shiftId),
      requestedShift: r.requestedShiftId ? shiftDto(r.requestedShiftId) : null,
      proposer: { id: r.proposerEmployeeId, fullName: nameById.get(r.proposerEmployeeId) ?? 'Former employee' },
      target: { id: r.targetEmployeeId, fullName: nameById.get(r.targetEmployeeId) ?? 'Former employee' },
      note: r.note,
      decisionNote: r.decisionNote,
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async one(id: string): Promise<ShiftSwap> {
    const [row] = await this.db.select().from(shiftSwaps).where(eq(shiftSwaps.id, id)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Swap request not found.');
    return (await this.dtos([row]))[0];
  }

  /** Every swap, newest first (owner). */
  async listAll(query: ShiftSwapListQuery): Promise<ShiftSwap[]> {
    const rows = await this.db
      .select()
      .from(shiftSwaps)
      .where(query.status ? eq(shiftSwaps.status, query.status) : undefined)
      .orderBy(desc(shiftSwaps.createdAt), desc(shiftSwaps.id))
      .limit(200);
    return this.dtos(rows);
  }

  /** Active staff the caller can offer a shift to. */
  async colleagues(employeeId: string | null): Promise<Colleague[]> {
    if (!employeeId) return [];
    return this.db
      .select({ id: employees.id, fullName: employees.fullName, position: employees.position })
      .from(employees)
      .where(and(eq(employees.status, 'ACTIVE'), ne(employees.id, employeeId)))
      .orderBy(asc(employees.fullName), asc(employees.id));
  }

  /** The caller's shifts that can still be offered: not started, not clocked into, not already in an open swap. */
  async upcomingShifts(employeeId: string | null): Promise<Shift[]> {
    if (!employeeId) return [];
    const rows = await this.db
      .select({ shift: staffShifts, fullName: employees.fullName })
      .from(staffShifts)
      .innerJoin(employees, eq(employees.id, staffShifts.employeeId))
      .where(and(eq(staffShifts.employeeId, employeeId), isNull(staffShifts.clockInAt), gt(staffShifts.startsAt, this.now())))
      .orderBy(asc(staffShifts.startsAt))
      .limit(60);
    const ids = rows.map((r) => r.shift.id);
    const open = ids.length
      ? await this.db
          .select({ shiftId: shiftSwaps.shiftId, requested: shiftSwaps.requestedShiftId })
          .from(shiftSwaps)
          .where(and(inArray(shiftSwaps.status, OPEN), or(inArray(shiftSwaps.shiftId, ids), inArray(shiftSwaps.requestedShiftId, ids))))
      : [];
    const taken = new Set(open.flatMap((o) => [o.shiftId, o.requested]).filter((id): id is string => Boolean(id)));
    return rows
      .filter((r) => !taken.has(r.shift.id))
      .map((r) => ({
        id: r.shift.id,
        employee: { id: r.shift.employeeId, fullName: r.fullName },
        roleLabel: r.shift.roleLabel,
        startsAt: r.shift.startsAt.toISOString(),
        endsAt: r.shift.endsAt.toISOString(),
        clockInAt: null,
        clockOutAt: null,
        status: 'SCHEDULED' as const,
      }));
  }

  /** Swaps the caller proposed or was asked to take. */
  async listMine(employeeId: string | null): Promise<ShiftSwap[]> {
    if (!employeeId) return [];
    const rows = await this.db
      .select()
      .from(shiftSwaps)
      .where(or(eq(shiftSwaps.proposerEmployeeId, employeeId), eq(shiftSwaps.targetEmployeeId, employeeId)))
      .orderBy(desc(shiftSwaps.createdAt), desc(shiftSwaps.id))
      .limit(100);
    return this.dtos(rows, employeeId);
  }

  // ------------------------------------------------------------------ rules shared by every step

  private assertUpcoming(shift: ShiftRow) {
    if (shift.clockInAt || shift.startsAt.getTime() <= this.now().getTime()) {
      throw new DomainError('SHIFT_STARTED', 409, 'That shift has already started, so it cannot be swapped.');
    }
  }

  private async assertActive(executor: DbExecutor, employeeId: string) {
    const [row] = await executor.select({ status: employees.status }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Employee not found.');
    if (row.status !== 'ACTIVE') throw new DomainError('EMPLOYEE_INACTIVE', 409, 'That employee is not active.');
  }

  /** Nobody can be handed a shift on a day they are on approved leave. */
  private async assertNotOnLeave(executor: DbExecutor, employeeId: string, shift: ShiftRow) {
    const day = clubDateOf(shift.startsAt, this.timezone);
    const [clash] = await executor
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'APPROVED'), lte(leaveRequests.fromDate, day), gte(leaveRequests.toDate, day)))
      .limit(1);
    if (clash) throw new DomainError('ON_LEAVE', 409, 'That employee is on approved leave on the day of the shift.');
  }

  /** Would `employeeId` be double-booked on `shift`, ignoring the shifts that are leaving them? */
  private async assertFree(executor: DbExecutor, employeeId: string, shift: ShiftRow, leaving: string[]) {
    const [clash] = await executor
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.employeeId, employeeId),
          lt(staffShifts.startsAt, shift.endsAt),
          gt(staffShifts.endsAt, shift.startsAt),
          leaving.length ? and(...leaving.map((id) => ne(staffShifts.id, id))) : undefined
        )
      )
      .limit(1);
    if (clash) throw new DomainError('SHIFT_OVERLAP', 409, 'That would put someone on two overlapping shifts.');
  }

  private async lockShifts(executor: DbExecutor, ids: string[]): Promise<Map<string, ShiftRow>> {
    // Locked in id order so two approvals touching the same shifts cannot deadlock each other.
    const rows = await executor.select().from(staffShifts).where(inArray(staffShifts.id, ids)).orderBy(staffShifts.id).for('update');
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The checks a swap must pass, now and again when it is approved. Throws a 4xx DomainError. */
  private async assertSwappable(executor: DbExecutor, swap: Pick<SwapRow, 'shiftId' | 'requestedShiftId' | 'proposerEmployeeId' | 'targetEmployeeId'>, forUpdate: boolean) {
    const ids = [swap.shiftId, ...(swap.requestedShiftId ? [swap.requestedShiftId] : [])];
    const shifts = forUpdate
      ? await this.lockShifts(executor, ids)
      : new Map((await executor.select().from(staffShifts).where(inArray(staffShifts.id, ids))).map((r) => [r.id, r]));
    const mine = shifts.get(swap.shiftId);
    const theirs = swap.requestedShiftId ? shifts.get(swap.requestedShiftId) : undefined;
    if (!mine || (swap.requestedShiftId && !theirs)) throw new DomainError('SWAP_STALE', 409, 'One of the shifts no longer exists.');
    if (mine.employeeId !== swap.proposerEmployeeId || (theirs && theirs.employeeId !== swap.targetEmployeeId)) {
      throw new DomainError('SWAP_STALE', 409, 'One of the shifts has been reassigned since this was requested.');
    }
    this.assertUpcoming(mine);
    if (theirs) this.assertUpcoming(theirs);
    await this.assertActive(executor, swap.proposerEmployeeId);
    await this.assertActive(executor, swap.targetEmployeeId);
    // A true swap whose two shifts overlap cannot be applied one row at a time without a moment of double-booking.
    if (theirs && mine.startsAt < theirs.endsAt && mine.endsAt > theirs.startsAt) {
      throw new DomainError('SHIFT_OVERLAP', 409, 'The two shifts overlap each other, so they cannot be swapped.');
    }
    await this.assertNotOnLeave(executor, swap.targetEmployeeId, mine);
    await this.assertFree(executor, swap.targetEmployeeId, mine, theirs ? [theirs.id] : []);
    if (theirs) {
      await this.assertNotOnLeave(executor, swap.proposerEmployeeId, theirs);
      await this.assertFree(executor, swap.proposerEmployeeId, theirs, [mine.id]);
    }
    return { mine, theirs };
  }

  private async tell(executor: DbExecutor, userIds: Array<string | null>, title: string, body: string, swapId: string, key: string) {
    await new NotificationService(executor).notifyUsers(
      userIds.filter((id): id is string => Boolean(id)),
      { type: 'SHIFT_SWAP', title, body, link: '/shifts', data: { swapId } },
      `swap:${swapId}:${key}`
    );
  }

  private describe(mine: ShiftRow) {
    return clubDateOf(mine.startsAt, this.timezone);
  }

  // ------------------------------------------------------------------ steps

  /** A staff member offers one of their own upcoming shifts. */
  async propose(proposerEmployeeId: string | null, input: CreateShiftSwapRequest): Promise<ShiftSwap> {
    if (!proposerEmployeeId) throw new DomainError('NOT_AN_EMPLOYEE', 404, 'This account has no employee record.');
    if (input.targetEmployeeId === proposerEmployeeId) throw new DomainError('INVALID_SWAP', 422, 'Choose a colleague, not yourself.');
    const id = await this.db
      .transaction(async (tx) => {
        const ids = [input.shiftId, ...(input.requestedShiftId ? [input.requestedShiftId] : [])];
        const locked = await this.lockShifts(tx, ids);
        const mine = locked.get(input.shiftId);
        if (!mine) throw new DomainError('NOT_FOUND', 404, 'Shift not found.');
        if (mine.employeeId !== proposerEmployeeId) throw new DomainError('FORBIDDEN', 403, 'You can only offer your own shifts.');
        const [target] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.targetEmployeeId)).limit(1);
        if (!target) throw new DomainError('NOT_FOUND', 404, 'Colleague not found.');
        if (input.requestedShiftId) {
          const theirs = locked.get(input.requestedShiftId);
          if (!theirs) throw new DomainError('NOT_FOUND', 404, 'The shift you asked for was not found.');
          if (theirs.employeeId !== input.targetEmployeeId) throw new DomainError('INVALID_SWAP', 422, 'The shift you asked for does not belong to that colleague.');
        }
        const [open] = await tx
          .select({ id: shiftSwaps.id })
          .from(shiftSwaps)
          .where(and(inArray(shiftSwaps.status, OPEN), or(inArray(shiftSwaps.shiftId, ids), inArray(shiftSwaps.requestedShiftId, ids))))
          .limit(1);
        if (open) throw new DomainError('SWAP_PENDING', 409, 'There is already an open swap request for one of those shifts.');
        const draft = { shiftId: input.shiftId, requestedShiftId: input.requestedShiftId ?? null, proposerEmployeeId, targetEmployeeId: input.targetEmployeeId };
        const { mine: shift } = await this.assertSwappable(tx, draft, false);
        const [row] = await tx.insert(shiftSwaps).values({ ...draft, note: input.note ?? null }).returning();
        const [proposer] = await tx.select({ fullName: employees.fullName }).from(employees).where(eq(employees.id, proposerEmployeeId)).limit(1);
        const [targetUser] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, input.targetEmployeeId)).limit(1);
        await this.tell(tx, [targetUser?.userId ?? null], 'Shift swap request', `${proposer?.fullName ?? 'A colleague'} asked you to take their shift on ${this.describe(shift)}.`, row.id, 'requested');
        return row.id;
      })
      .catch((error) => {
        if (pgCode(error) === UNIQUE_VIOLATION) throw new DomainError('SWAP_PENDING', 409, 'There is already an open swap request for one of those shifts.');
        throw error;
      });
    return this.one(id);
  }

  /** The colleague answers. Only the person it was offered to can. */
  async respond(responderEmployeeId: string | null, id: string, input: ShiftSwapResponseRequest): Promise<ShiftSwap> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(shiftSwaps).where(eq(shiftSwaps.id, id)).for('update');
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Swap request not found.');
      if (!responderEmployeeId || row.targetEmployeeId !== responderEmployeeId) throw new DomainError('FORBIDDEN', 403, 'Only the colleague this was offered to can answer it.');
      if (row.status !== 'PENDING') throw new DomainError('SWAP_NOT_PENDING', 409, 'This request has already been answered or withdrawn.');
      const accepted = input.response === 'ACCEPT';
      if (accepted) await this.assertSwappable(tx, row, false);
      await tx.update(shiftSwaps).set({ status: accepted ? 'ACCEPTED' : 'DECLINED', respondedAt: this.now() }).where(eq(shiftSwaps.id, id));
      const [responder] = await tx.select({ fullName: employees.fullName }).from(employees).where(eq(employees.id, responderEmployeeId)).limit(1);
      const [shift] = await tx.select().from(staffShifts).where(eq(staffShifts.id, row.shiftId)).limit(1);
      const when = shift ? this.describe(shift) : 'the requested day';
      if (accepted) {
        await new NotificationService(tx).notifyRole(
          REVIEW_ROLES,
          { type: 'SHIFT_SWAP', title: 'Shift swap needs approval', body: `${responder?.fullName ?? 'A colleague'} agreed to take a shift on ${when}.`, link: '/shifts', data: { swapId: id } },
          `swap:${id}:accepted`
        );
      }
      await this.tell(tx, [await this.userIdOfIn(tx, row.proposerEmployeeId)], accepted ? 'Swap accepted' : 'Swap declined', `${responder?.fullName ?? 'Your colleague'} ${accepted ? 'accepted' : 'declined'} your request for ${when}.${accepted ? ' It now waits for the owner.' : ''}`, id, accepted ? 'accepted-proposer' : 'declined');
    });
    return this.one(id);
  }

  private async userIdOfIn(executor: DbExecutor, employeeId: string): Promise<string | null> {
    const [row] = await executor.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    return row?.userId ?? null;
  }

  /** The proposer withdraws an open request. */
  async cancel(proposerEmployeeId: string | null, id: string): Promise<ShiftSwap> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(shiftSwaps).where(eq(shiftSwaps.id, id)).for('update');
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Swap request not found.');
      if (!proposerEmployeeId || row.proposerEmployeeId !== proposerEmployeeId) throw new DomainError('FORBIDDEN', 403, 'Only the person who asked can withdraw this request.');
      if (!OPEN.includes(row.status)) throw new DomainError('SWAP_NOT_OPEN', 409, 'This request is already closed.');
      await tx.update(shiftSwaps).set({ status: 'CANCELLED' }).where(eq(shiftSwaps.id, id));
      await this.tell(tx, [await this.userIdOfIn(tx, row.targetEmployeeId)], 'Swap withdrawn', 'A colleague withdrew their shift swap request.', id, 'cancelled');
    });
    return this.one(id);
  }

  /**
   * The owner decides. Approving needs the colleague to have accepted, re-checks everything (the shifts may
   * have changed since), and moves both shifts atomically. Rejecting is the override and works at any open stage.
   */
  async decide(actorId: string, id: string, input: ShiftSwapDecisionRequest): Promise<ShiftSwap> {
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(shiftSwaps).where(eq(shiftSwaps.id, id)).for('update');
        if (!row) throw new DomainError('NOT_FOUND', 404, 'Swap request not found.');
        if (!OPEN.includes(row.status)) throw new DomainError('SWAP_NOT_OPEN', 409, 'This request is already closed.');
        const decided = { decidedBy: actorId, decidedAt: this.now(), decisionNote: input.note ?? null };
        if (input.decision === 'REJECTED') {
          await tx.update(shiftSwaps).set({ ...decided, status: 'REJECTED' }).where(eq(shiftSwaps.id, id));
        } else {
          if (row.status !== 'ACCEPTED') throw new DomainError('SWAP_NOT_ACCEPTED', 409, 'The colleague has not accepted this swap yet.');
          const { mine, theirs } = await this.assertSwappable(tx, row, true);
          // The proposer's shift goes first. With the two shifts known not to overlap, neither move can double-book anyone.
          await tx.update(staffShifts).set({ employeeId: row.targetEmployeeId }).where(eq(staffShifts.id, mine.id));
          if (theirs) await tx.update(staffShifts).set({ employeeId: row.proposerEmployeeId }).where(eq(staffShifts.id, theirs.id));
          await tx.update(shiftSwaps).set({ ...decided, status: 'APPROVED' }).where(eq(shiftSwaps.id, id));
        }
        const [shift] = await tx.select().from(staffShifts).where(eq(staffShifts.id, row.shiftId)).limit(1);
        const when = shift ? this.describe(shift) : 'the requested day';
        const approved = input.decision === 'APPROVED';
        const text = approved ? `The owner approved the shift swap for ${when}.` : `The owner did not approve the shift swap for ${when}.${input.note ? ` ${input.note}` : ''}`;
        await this.tell(tx, [await this.userIdOfIn(tx, row.proposerEmployeeId), await this.userIdOfIn(tx, row.targetEmployeeId)], approved ? 'Swap approved' : 'Swap not approved', text, id, 'decided');
      });
    } catch (error) {
      if (pgCode(error) === EXCLUSION_VIOLATION) throw new DomainError('SHIFT_OVERLAP', 409, 'That would put someone on two overlapping shifts.');
      throw error;
    }
    return this.one(id);
  }
}
