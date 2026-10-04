import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  employeeBankDetails,
  employees,
  leaveRequests,
  payrollRuns,
  payslips,
  staffShifts,
  systemSettings,
} from '@packages/db';
import type {
  BankDetails,
  Payslip,
  PayrollRun,
  PayrollRunDetail,
  UpdateBankDetailsRequest,
  UpdatePayslipRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { open, seal } from '../lib/secret-box.js';
import { renderPdf, type PdfLine } from '../lib/simple-pdf.js';
import { addDays } from '../lib/club-date.js';
import { clubWallTimeToInstant } from './time.js';
import type { DbExecutor } from './db-types.js';
import { clipDays } from './hr.service.js';

const BANK_PURPOSE = 'employee-bank-details';

type SlipRow = typeof payslips.$inferSelect;
type RunRow = typeof payrollRuns.$inferSelect;

/** Whole-day proration in paise: `round(amount * days / total)`. */
export function prorate(amountPaise: number, days: number, total: number): number {
  return Math.round((amountPaise * days) / total);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Net pay = prorated base - unpaid leave - other deductions + bonus, never below zero. */
export function computeNet(slip: { basePaise: number; leaveDeductionPaise: number; bonusPaise: number; otherDeductionPaise: number }): number {
  return Math.max(0, slip.basePaise - slip.leaveDeductionPaise + slip.bonusPaise - slip.otherDeductionPaise);
}

const rupees = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export class PayrollService {
  constructor(
    private readonly db: DbExecutor,
    private readonly timezone: string,
    private readonly secret: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  // ------------------------------------------------------------------ bank details

  async getBank(employeeId: string): Promise<BankDetails> {
    await this.assertEmployee(employeeId);
    const [row] = await this.db.select().from(employeeBankDetails).where(eq(employeeBankDetails.employeeId, employeeId)).limit(1);
    return this.bankDto(row);
  }

  async setBank(employeeId: string, input: UpdateBankDetailsRequest, actorUserId: string): Promise<BankDetails> {
    await this.assertEmployee(employeeId);
    const values = {
      accountHolder: input.accountHolder,
      accountNumberEnc: seal(input.accountNumber, this.secret, BANK_PURPOSE),
      accountLast4: input.accountNumber.slice(-4),
      ifsc: input.ifsc,
      bankName: input.bankName ?? null,
      upiId: input.upiId ?? null,
      updatedBy: actorUserId,
      updatedAt: this.now(),
    };
    const [row] = await this.db
      .insert(employeeBankDetails)
      .values({ employeeId, ...values })
      .onConflictDoUpdate({ target: employeeBankDetails.employeeId, set: values })
      .returning();
    return this.bankDto(row);
  }

  /** Only for payout tooling inside the API; never exposed over HTTP. */
  async revealAccountNumber(employeeId: string): Promise<string | null> {
    const [row] = await this.db.select().from(employeeBankDetails).where(eq(employeeBankDetails.employeeId, employeeId)).limit(1);
    return row ? open(row.accountNumberEnc, this.secret, BANK_PURPOSE) : null;
  }

  private bankDto(row: typeof employeeBankDetails.$inferSelect | undefined): BankDetails {
    if (!row) return { configured: false };
    return {
      configured: true,
      accountHolder: row.accountHolder,
      accountNumberMasked: `XXXXXX${row.accountLast4}`,
      ifsc: row.ifsc,
      bankName: row.bankName,
      upiId: row.upiId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async assertEmployee(id: string) {
    const [e] = await this.db.select({ id: employees.id }).from(employees).where(eq(employees.id, id)).limit(1);
    if (!e) throw new DomainError('NOT_FOUND', 404, 'Employee not found.');
  }

  // ------------------------------------------------------------------ runs

  async listRuns(): Promise<PayrollRun[]> {
    const rows = await this.db.select().from(payrollRuns).orderBy(desc(payrollRuns.month));
    const totals = await this.totals(rows.map((r) => r.id));
    return rows.map((r) => this.runDto(r, totals.get(r.id)));
  }

  async getRun(id: string): Promise<PayrollRunDetail> {
    const run = await this.loadRun(id);
    const slips = await this.db.select().from(payslips).where(eq(payslips.runId, id)).orderBy(asc(payslips.employeeName));
    const dtos = await this.slipDtos(run, slips);
    return {
      ...this.runDto(run, { headcount: dtos.length, net: dtos.reduce((n, s) => n + s.netPaise, 0) }),
      payslips: dtos,
    };
  }

  /** Builds a DRAFT run for `month` from active staff hired by month end. One run per month. */
  async createRun(month: string, actorUserId: string): Promise<PayrollRunDetail> {
    const dim = daysInMonth(month);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(dim).padStart(2, '0')}`;
    const staff = await this.db
      .select()
      .from(employees)
      .where(and(eq(employees.status, 'ACTIVE'), lte(employees.hiredOn, monthEnd)))
      .orderBy(asc(employees.fullName));
    if (staff.length === 0) throw new DomainError('NO_EMPLOYEES', 422, 'There are no active employees on payroll for that month.');

    const yearStart = `${month.slice(0, 4)}-01-01`;
    const dayBeforeMonth = addDays(monthStart, -1);
    const from = clubWallTimeToInstant(monthStart, 0, this.timezone);
    const to = clubWallTimeToInstant(addDays(monthEnd, 1), 0, this.timezone);
    const ids = staff.map((s) => s.id);
    const [leave, shifts] = await Promise.all([
      this.db
        .select({ employeeId: leaveRequests.employeeId, fromDate: leaveRequests.fromDate, toDate: leaveRequests.toDate })
        .from(leaveRequests)
        .where(and(eq(leaveRequests.status, 'APPROVED'), inArray(leaveRequests.employeeId, ids), lte(leaveRequests.fromDate, monthEnd), gte(leaveRequests.toDate, yearStart))),
      this.db
        .select({
          employeeId: staffShifts.employeeId,
          scheduled: sql<number>`count(*)::int`,
          worked: sql<number>`count(*) filter (where ${staffShifts.clockInAt} is not null)::int`,
        })
        .from(staffShifts)
        .where(and(inArray(staffShifts.employeeId, ids), gte(staffShifts.startsAt, from), lt(staffShifts.startsAt, to)))
        .groupBy(staffShifts.employeeId),
    ]);
    const leaveDays = new Map<string, number>();
    // Approved leave earlier in the same year, which already used up part of the yearly allowance.
    const earlierDays = new Map<string, number>();
    for (const l of leave) {
      const days = clipDays(l.fromDate, l.toDate, monthStart, monthEnd);
      if (days > 0) leaveDays.set(l.employeeId, (leaveDays.get(l.employeeId) ?? 0) + days);
      const earlier = clipDays(l.fromDate, l.toDate, yearStart, dayBeforeMonth);
      if (earlier > 0) earlierDays.set(l.employeeId, (earlierDays.get(l.employeeId) ?? 0) + earlier);
    }
    const shiftStats = new Map(shifts.map((s) => [s.employeeId, s]));

    let runId: string;
    try {
      runId = await this.db.transaction(async (tx) => {
        const [run] = await tx.insert(payrollRuns).values({ month, createdBy: actorUserId }).returning({ id: payrollRuns.id });
        await tx.insert(payslips).values(
          staff.map((e) => {
            const joinedDay = e.hiredOn > monthStart ? Number(e.hiredOn.slice(8, 10)) : 1;
            const payableDays = dim - (joinedDay - 1);
            const basePaise = prorate(e.monthlySalaryPaise, payableDays, dim);
            const stats = shiftStats.get(e.id);
            const monthLeave = Math.min(dim, leaveDays.get(e.id) ?? 0);
            // Leave beyond the yearly allowance is suggested as unpaid. It is only a suggestion: the owner applies or overrides it.
            const allowanceLeft = Math.max(0, e.leaveAllowanceDays - (earlierDays.get(e.id) ?? 0));
            const suggestedUnpaidLeaveDays = Math.min(payableDays, Math.max(0, monthLeave - allowanceLeft));
            return {
              runId: run.id,
              employeeId: e.id,
              employeeName: e.fullName,
              position: e.position,
              department: e.department,
              monthlySalaryPaise: e.monthlySalaryPaise,
              daysInMonth: dim,
              payableDays,
              basePaise,
              netPaise: basePaise,
              approvedLeaveDays: monthLeave,
              suggestedUnpaidLeaveDays,
              shiftsScheduled: stats?.scheduled ?? 0,
              shiftsWorked: stats?.worked ?? 0,
            };
          })
        );
        return run.id;
      });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === '23505') throw new DomainError('PAYROLL_RUN_EXISTS', 409, `A payroll run for ${month} already exists.`);
      throw error;
    }
    return this.getRun(runId);
  }

  async updateSlip(slipId: string, patch: UpdatePayslipRequest): Promise<Payslip> {
    const [slip] = await this.db.select().from(payslips).where(eq(payslips.id, slipId)).limit(1);
    if (!slip) throw new DomainError('NOT_FOUND', 404, 'Payslip not found.');
    const run = await this.loadRun(slip.runId);
    this.assertDraft(run);
    const unpaidLeaveDays = patch.unpaidLeaveDays ?? slip.unpaidLeaveDays;
    if (unpaidLeaveDays > slip.payableDays) throw new DomainError('VALIDATION_ERROR', 422, `Unpaid leave cannot exceed the ${slip.payableDays} payable days.`);
    const next = {
      unpaidLeaveDays,
      leaveDeductionPaise: prorate(slip.monthlySalaryPaise, unpaidLeaveDays, slip.daysInMonth),
      bonusPaise: patch.bonusPaise ?? slip.bonusPaise,
      otherDeductionPaise: patch.otherDeductionPaise ?? slip.otherDeductionPaise,
    };
    const [row] = await this.db
      .update(payslips)
      .set({ ...next, netPaise: computeNet({ basePaise: slip.basePaise, ...next }), ...(patch.note !== undefined && { note: patch.note }) })
      .where(eq(payslips.id, slipId))
      .returning();
    return (await this.slipDtos(run, [row]))[0];
  }

  async deleteRun(id: string): Promise<void> {
    this.assertDraft(await this.loadRun(id));
    await this.db.delete(payrollRuns).where(eq(payrollRuns.id, id));
  }

  async finalize(id: string): Promise<PayrollRunDetail> {
    const run = await this.loadRun(id);
    if (run.status !== 'DRAFT') throw new DomainError('INVALID_RUN_STATUS', 409, `This run is already ${run.status.toLowerCase()}.`);
    await this.db.update(payrollRuns).set({ status: 'FINALIZED', finalizedAt: this.now() }).where(and(eq(payrollRuns.id, id), eq(payrollRuns.status, 'DRAFT')));
    return this.getRun(id);
  }

  async markPaid(id: string): Promise<PayrollRunDetail> {
    const run = await this.loadRun(id);
    if (run.status !== 'FINALIZED') throw new DomainError('INVALID_RUN_STATUS', 409, run.status === 'PAID' ? 'This run is already paid.' : 'Finalize the run before marking it paid.');
    await this.db.update(payrollRuns).set({ status: 'PAID', paidAt: this.now() }).where(and(eq(payrollRuns.id, id), eq(payrollRuns.status, 'FINALIZED')));
    return this.getRun(id);
  }

  // ------------------------------------------------------------------ payslips

  /** Every payslip of one employee, newest month first (owner view; drafts included). */
  async employeeSlips(employeeId: string): Promise<Payslip[]> {
    await this.assertEmployee(employeeId);
    const rows = await this.db
      .select({ slip: payslips, run: payrollRuns })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .where(eq(payslips.employeeId, employeeId))
      .orderBy(desc(payrollRuns.month));
    return Promise.all(rows.map(async (r) => (await this.slipDtos(r.run, [r.slip]))[0]));
  }

  /** Finalised payslips of the employee linked to `userId`. */
  async mySlips(userId: string): Promise<Payslip[]> {
    const rows = await this.db
      .select({ slip: payslips, run: payrollRuns })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(and(eq(employees.userId, userId), inArray(payrollRuns.status, ['FINALIZED', 'PAID'])))
      .orderBy(desc(payrollRuns.month));
    return Promise.all(rows.map(async (r) => (await this.slipDtos(r.run, [r.slip]))[0]));
  }

  /** The PDF for a payslip. With `userId` it must be that person's own, and the run must be finalised. */
  async pdf(slipId: string, scope: { userId?: string }): Promise<{ filename: string; body: Buffer }> {
    const [row] = await this.db
      .select({ slip: payslips, run: payrollRuns, userId: employees.userId })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(eq(payslips.id, slipId))
      .limit(1);
    // A person asking for someone else's payslip gets the same 404 as a missing one.
    if (!row || (scope.userId !== undefined && row.userId !== scope.userId)) throw new DomainError('NOT_FOUND', 404, 'Payslip not found.');
    if (row.run.status === 'DRAFT' && scope.userId !== undefined) throw new DomainError('NOT_FOUND', 404, 'Payslip not found.');
    const [profile] = await this.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'club.profile')).limit(1);
    const clubName = String((profile?.value as { name?: unknown } | undefined)?.name ?? 'Baseline');
    const s = row.slip;
    const lines: PdfLine[] = [
      { text: clubName, size: 18, bold: true },
      { text: `Payslip for ${s.employeeName === '' ? 'employee' : s.employeeName}`, size: 13, gap: 4 },
      { text: `Month: ${row.run.month}${row.run.status === 'DRAFT' ? '   (DRAFT, not final)' : ''}`, gap: 2 },
      { text: `${s.position}, ${s.department.replace(/_/g, ' ').toLowerCase()}` },
      { text: 'Earnings', bold: true, size: 12, gap: 18 },
      { text: `Monthly salary`, right: rupees(s.monthlySalaryPaise) },
      { text: `Base pay (${s.payableDays} of ${s.daysInMonth} days)`, right: rupees(s.basePaise) },
      { text: 'Bonus', right: rupees(s.bonusPaise) },
      { text: 'Deductions', bold: true, size: 12, gap: 14 },
      { text: `Unpaid leave (${s.unpaidLeaveDays} days)`, right: `- ${rupees(s.leaveDeductionPaise)}` },
      { text: 'Other deductions', right: `- ${rupees(s.otherDeductionPaise)}` },
      { text: 'Net pay', bold: true, size: 14, gap: 16, right: rupees(s.netPaise) },
      { text: 'Attendance', bold: true, size: 12, gap: 18 },
      { text: `Approved leave days: ${s.approvedLeaveDays}` },
      { text: `Shifts worked: ${s.shiftsWorked} of ${s.shiftsScheduled} scheduled` },
      ...(s.note ? [{ text: `Note: ${s.note}`, gap: 10 }] : []),
      { text: 'This is a computer-generated payslip.', size: 9, gap: 30 },
    ];
    return { filename: `payslip-${row.run.month}-${s.employeeName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'employee'}.pdf`, body: renderPdf(lines, `Payslip ${row.run.month}`) };
  }

  // ------------------------------------------------------------------ helpers

  private async loadRun(id: string): Promise<RunRow> {
    const [run] = await this.db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
    if (!run) throw new DomainError('NOT_FOUND', 404, 'Payroll run not found.');
    return run;
  }

  private assertDraft(run: RunRow) {
    if (run.status !== 'DRAFT') throw new DomainError('RUN_LOCKED', 409, `This run is ${run.status.toLowerCase()} and can no longer change.`);
  }

  private async totals(ids: string[]) {
    const map = new Map<string, { headcount: number; net: number }>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .select({ runId: payslips.runId, headcount: sql<number>`count(*)::int`, net: sql<number>`coalesce(sum(${payslips.netPaise}), 0)::bigint` })
      .from(payslips)
      .where(inArray(payslips.runId, ids))
      .groupBy(payslips.runId);
    for (const r of rows) map.set(r.runId, { headcount: Number(r.headcount), net: Number(r.net) });
    return map;
  }

  private runDto(run: RunRow, total: { headcount: number; net: number } | undefined): PayrollRun {
    return {
      id: run.id,
      month: run.month,
      status: run.status,
      headcount: total?.headcount ?? 0,
      totalNetPaise: total?.net ?? 0,
      createdAt: run.createdAt.toISOString(),
      finalizedAt: run.finalizedAt?.toISOString() ?? null,
      paidAt: run.paidAt?.toISOString() ?? null,
    };
  }

  private async slipDtos(run: RunRow, slips: SlipRow[]): Promise<Payslip[]> {
    const banks = slips.length
      ? await this.db.select({ id: employeeBankDetails.employeeId }).from(employeeBankDetails).where(inArray(employeeBankDetails.employeeId, slips.map((s) => s.employeeId)))
      : [];
    const withBank = new Set(banks.map((b) => b.id));
    return slips.map((s) => ({
      id: s.id,
      runId: s.runId,
      month: run.month,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      position: s.position,
      department: s.department,
      monthlySalaryPaise: s.monthlySalaryPaise,
      daysInMonth: s.daysInMonth,
      payableDays: s.payableDays,
      basePaise: s.basePaise,
      unpaidLeaveDays: s.unpaidLeaveDays,
      suggestedUnpaidLeaveDays: s.suggestedUnpaidLeaveDays,
      leaveDeductionPaise: s.leaveDeductionPaise,
      bonusPaise: s.bonusPaise,
      otherDeductionPaise: s.otherDeductionPaise,
      netPaise: s.netPaise,
      approvedLeaveDays: s.approvedLeaveDays,
      shiftsScheduled: s.shiftsScheduled,
      shiftsWorked: s.shiftsWorked,
      note: s.note,
      bankConfigured: withBank.has(s.employeeId),
    }));
  }
}
