import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { employees, leaveRequests, users } from '@packages/db';
import type {
  CreateEmployeeRequest,
  CreateLeaveRequest,
  Employee,
  EmployeeListQuery,
  LeaveDecisionRequest,
  LeaveListQuery,
  LeaveRequest,
  PayrollSummary,
  UpdateEmployeeRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { EXCLUSION_VIOLATION, FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION, pageMeta, pgCode } from '../lib/db-errors.js';
import type { DbExecutor } from './db-types.js';
import { NotificationService } from './notification.service.js';
import { addDays, clubDateOf, daysBetween } from './time.js';

type EmployeeRow = typeof employees.$inferSelect;
type LeaveRow = typeof leaveRequests.$inferSelect;

/** Owners are told about every new leave request. */
const LEAVE_REQUEST_ROLES = ['OWNER'];

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Whole calendar days in an inclusive date range. */
export const leaveDays = (fromDate: string, toDate: string) => daysBetween(fromDate, toDate) + 1;

/** Employees, leave and payroll (API_CONTRACT.md section 10.3). */
export class HrService {
  constructor(
    private readonly db: DbExecutor,
    private readonly timezone: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private today() {
    return clubDateOf(this.now(), this.timezone);
  }

  // ------------------------------------------------------------------ employees

  private async leaveDaysThisYear(ids: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!ids.length) return result;
    const year = this.today().slice(0, 4);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    // Approved leave clipped to the calendar year, so a December-to-January request counts once per year.
    const rows = await this.db
      .select({
        employeeId: leaveRequests.employeeId,
        days: sql<string>`coalesce(sum(least(${leaveRequests.toDate}, ${yearEnd}::date) - greatest(${leaveRequests.fromDate}, ${yearStart}::date) + 1), 0)`,
      })
      .from(leaveRequests)
      .where(
        and(
          inArray(leaveRequests.employeeId, ids),
          eq(leaveRequests.status, 'APPROVED'),
          lte(leaveRequests.fromDate, yearEnd),
          gte(leaveRequests.toDate, yearStart)
        )
      )
      .groupBy(leaveRequests.employeeId);
    for (const row of rows) result.set(row.employeeId, Number(row.days));
    return result;
  }

  private toEmployee(row: EmployeeRow, leaveDays: number): Employee {
    return {
      id: row.id,
      fullName: row.fullName,
      position: row.position,
      department: row.department,
      monthlySalaryPaise: row.monthlySalaryPaise,
      hiredOn: row.hiredOn,
      status: row.status,
      leaveDaysThisYear: leaveDays,
    };
  }

  async listEmployees(query: EmployeeListQuery): Promise<Employee[]> {
    const rows = await this.db
      .select()
      .from(employees)
      .where(
        and(
          query.department ? eq(employees.department, query.department as EmployeeRow['department']) : undefined,
          query.status ? eq(employees.status, query.status as EmployeeRow['status']) : undefined,
          query.q ? or(ilike(employees.fullName, likePattern(query.q)), ilike(employees.position, likePattern(query.q))) : undefined
        )
      )
      .orderBy(asc(employees.fullName), asc(employees.id));
    const leave = await this.leaveDaysThisYear(rows.map((row) => row.id));
    return rows.map((row) => this.toEmployee(row, leave.get(row.id) ?? 0));
  }

  private async assertUserExists(userId: string) {
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new DomainError('NOT_FOUND', 404, 'The linked user account was not found.');
  }

  private translateEmployeeError(error: unknown): never {
    const code = pgCode(error);
    if (code === UNIQUE_VIOLATION) throw new DomainError('USER_ALREADY_LINKED', 409, 'That user account is already linked to another employee.');
    if (code === FOREIGN_KEY_VIOLATION) throw new DomainError('NOT_FOUND', 404, 'The linked user account was not found.');
    throw error;
  }

  async createEmployee(input: CreateEmployeeRequest): Promise<Employee> {
    if (input.userId) await this.assertUserExists(input.userId);
    try {
      const [row] = await this.db
        .insert(employees)
        .values({
          fullName: input.fullName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          position: input.position,
          department: input.department,
          monthlySalaryPaise: input.monthlySalaryPaise,
          hiredOn: input.hiredOn,
          userId: input.userId ?? null,
        })
        .returning();
      return this.toEmployee(row, 0);
    } catch (error) {
      return this.translateEmployeeError(error);
    }
  }

  async updateEmployee(id: string, input: UpdateEmployeeRequest): Promise<Employee> {
    if (input.userId) await this.assertUserExists(input.userId);
    const values = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    try {
      const [row] = Object.keys(values).length
        ? await this.db.update(employees).set(values).where(eq(employees.id, id)).returning()
        : await this.db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Employee not found.');
      const leave = await this.leaveDaysThisYear([row.id]);
      return this.toEmployee(row, leave.get(row.id) ?? 0);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      return this.translateEmployeeError(error);
    }
  }

  async employeeForUser(userId: string): Promise<{ id: string; fullName: string } | null> {
    const [row] = await this.db.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(eq(employees.userId, userId)).limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------------- leave

  private async toLeaveRequests(rows: LeaveRow[]): Promise<LeaveRequest[]> {
    if (!rows.length) return [];
    const emps = await this.db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(inArray(employees.id, [...new Set(rows.map((row) => row.employeeId))]));
    const deciderIds = [...new Set(rows.map((row) => row.decidedBy).filter((id): id is string => Boolean(id)))];
    const deciders = deciderIds.length
      ? await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, deciderIds))
      : [];
    const empName = new Map(emps.map((e) => [e.id, e.fullName]));
    const decider = new Map(deciders.map((u) => [u.id, u.name || u.email]));
    return rows.map((row) => ({
      id: row.id,
      employee: { id: row.employeeId, fullName: empName.get(row.employeeId) ?? 'Former employee' },
      leaveType: row.leaveType,
      fromDate: row.fromDate,
      toDate: row.toDate,
      days: leaveDays(row.fromDate, row.toDate),
      reason: row.reason,
      status: row.status,
      decidedBy: row.decidedBy ? { id: row.decidedBy, name: decider.get(row.decidedBy) ?? 'Former user' } : null,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decisionNote: row.decisionNote,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async pageOfLeave(where: ReturnType<typeof and>, page: number, limit: number) {
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(leaveRequests)
        .where(where)
        .orderBy(desc(leaveRequests.createdAt), desc(leaveRequests.id))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: count() }).from(leaveRequests).where(where),
    ]);
    return { data: await this.toLeaveRequests(rows), meta: pageMeta(page, limit, Number(total?.n ?? 0)) };
  }

  listLeave(query: LeaveListQuery) {
    return this.pageOfLeave(
      and(
        query.status ? eq(leaveRequests.status, query.status) : undefined,
        query.employeeId ? eq(leaveRequests.employeeId, query.employeeId) : undefined,
        // A request is "in" the window when the two date ranges overlap.
        query.from ? gte(leaveRequests.toDate, query.from) : undefined,
        query.to ? lte(leaveRequests.fromDate, query.to) : undefined
      ),
      query.page,
      query.limit
    );
  }

  async listMyLeave(userId: string, page: number, limit: number) {
    const own = await this.employeeForUser(userId);
    if (!own) return { data: [], meta: pageMeta(page, limit, 0) };
    return this.pageOfLeave(eq(leaveRequests.employeeId, own.id), page, limit);
  }

  async requestLeave(userId: string, input: CreateLeaveRequest): Promise<LeaveRequest> {
    const own = await this.employeeForUser(userId);
    if (!own) throw new DomainError('NOT_AN_EMPLOYEE', 404, 'This account has no employee record.');
    const created = await this.db.transaction(async (tx) => {
      // Serialise one employee's requests so two submissions cannot both pass the overlap check.
      await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, own.id)).for('update');
      const [clash] = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.employeeId, own.id),
            inArray(leaveRequests.status, ['PENDING', 'APPROVED']),
            lte(leaveRequests.fromDate, input.toDate),
            gte(leaveRequests.toDate, input.fromDate)
          )
        )
        .limit(1);
      if (clash) throw new DomainError('LEAVE_OVERLAP', 409, 'You already have leave in those dates.');
      const [row] = await tx
        .insert(leaveRequests)
        .values({ employeeId: own.id, leaveType: input.leaveType, fromDate: input.fromDate, toDate: input.toDate, reason: input.reason ?? null })
        .returning();
      await new NotificationService(tx).notifyRole(
        LEAVE_REQUEST_ROLES,
        {
          type: 'LEAVE_REQUEST',
          title: 'Leave request',
          body: `${own.fullName} asked for ${leaveDays(input.fromDate, input.toDate)} day(s) of ${input.leaveType.toLowerCase()} leave.`,
          link: '/hr',
          data: { leaveRequestId: row.id },
        },
        `leave-request:${row.id}`
      );
      return row;
    });
    return (await this.toLeaveRequests([created]))[0];
  }

  async decideLeave(id: string, input: LeaveDecisionRequest, actorId: string): Promise<LeaveRequest> {
    try {
      const decided = await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for('update');
        if (!row) throw new DomainError('NOT_FOUND', 404, 'Leave request not found.');
        if (row.status !== 'PENDING') throw new DomainError('ALREADY_DECIDED', 409, 'This leave request has already been decided.');
        if (input.decision === 'APPROVED') {
          const [clash] = await tx
            .select({ id: leaveRequests.id })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.employeeId, row.employeeId),
                eq(leaveRequests.status, 'APPROVED'),
                ne(leaveRequests.id, row.id),
                lte(leaveRequests.fromDate, row.toDate),
                gte(leaveRequests.toDate, row.fromDate)
              )
            )
            .limit(1);
          if (clash) throw new DomainError('LEAVE_OVERLAP', 409, 'The employee already has approved leave in those dates.');
        }
        const [updated] = await tx
          .update(leaveRequests)
          .set({ status: input.decision, decidedBy: actorId, decidedAt: this.now(), decisionNote: input.note ?? null })
          .where(eq(leaveRequests.id, id))
          .returning();
        const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, row.employeeId));
        if (employee?.userId) {
          await new NotificationService(tx).notifyUsers(
            [employee.userId],
            {
              type: 'LEAVE_DECIDED',
              title: `Leave ${input.decision.toLowerCase()}`,
              body: `${row.fromDate} to ${row.toDate}${input.note ? `: ${input.note}` : ''}`,
              link: '/hr',
              data: { leaveRequestId: row.id, decision: input.decision },
            },
            `leave-decided:${row.id}`
          );
        }
        return updated;
      });
      return (await this.toLeaveRequests([decided]))[0];
    } catch (error) {
      if (pgCode(error) === EXCLUSION_VIOLATION) {
        throw new DomainError('LEAVE_OVERLAP', 409, 'The employee already has approved leave in those dates.');
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------- payroll

  async payrollSummary(month: string): Promise<PayrollSummary> {
    const monthStart = `${month}-01`;
    const nextMonth = addDays(`${month}-28`, 4).slice(0, 7);
    const monthEnd = addDays(`${nextMonth}-01`, -1);
    // Active staff hired on or before the last day of the month are on that month's payroll.
    const staff = await this.db
      .select({ id: employees.id, fullName: employees.fullName, department: employees.department, salary: employees.monthlySalaryPaise })
      .from(employees)
      .where(and(eq(employees.status, 'ACTIVE'), lte(employees.hiredOn, monthEnd)));
    const byDepartment = new Map<string, { headcount: number; amountPaise: number }>();
    let totalPaise = 0;
    for (const person of staff) {
      const entry = byDepartment.get(person.department) ?? { headcount: 0, amountPaise: 0 };
      entry.headcount += 1;
      entry.amountPaise += person.salary;
      byDepartment.set(person.department, entry);
      totalPaise += person.salary;
    }
    const onLeave = staff.length
      ? await this.db
          .select({ employeeName: employees.fullName, fromDate: leaveRequests.fromDate, toDate: leaveRequests.toDate })
          .from(leaveRequests)
          .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
          .where(
            and(
              eq(leaveRequests.status, 'APPROVED'),
              inArray(leaveRequests.employeeId, staff.map((person) => person.id)),
              lte(leaveRequests.fromDate, monthEnd),
              gte(leaveRequests.toDate, monthStart)
            )
          )
          .orderBy(asc(leaveRequests.fromDate), asc(employees.fullName))
      : [];
    return {
      month,
      totalPaise,
      headcount: staff.length,
      byDepartment: [...byDepartment.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, value]) => ({ department, ...value })),
      onLeave,
    };
  }
}
