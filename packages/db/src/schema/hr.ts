import { pgTable, varchar, text, uuid, date, index, smallint, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { pk, tstz, createdAt, paise } from './_columns.js';

export type Department = 'FRONT_DESK' | 'BAR' | 'MAINTENANCE' | 'COACHING' | 'MANAGEMENT';
export type LeaveType = 'CASUAL' | 'SICK' | 'PAID';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export const employees = pgTable(
  'employees',
  {
    id: pk(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .unique(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    position: varchar('position', { length: 64 }).notNull(),
    department: varchar('department', { length: 24 }).$type<Department>().notNull(),
    monthlySalaryPaise: paise('monthly_salary_paise').notNull().default(0),
    hiredOn: date('hired_on', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 12 }).$type<'ACTIVE' | 'INACTIVE'>().notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_employees_department').on(t.department)]
);

export const staffShifts = pgTable(
  'staff_shifts',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .references(() => employees.id, { onDelete: 'cascade' })
      .notNull(),
    roleLabel: varchar('role_label', { length: 24 })
      .$type<'BAR' | 'FRONT_DESK' | 'KITCHEN' | 'OTHER'>()
      .notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    clockInAt: tstz('clock_in_at'),
    clockOutAt: tstz('clock_out_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_staff_shifts_employee').on(t.employeeId, t.startsAt),
    index('idx_staff_shifts_starts').on(t.startsAt),
  ]
);
// SQL (0003): CHECK (ends_at > starts_at); EXCLUDE no overlapping shifts per employee.

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: pk(),
    employeeId: uuid('employee_id')
      .references(() => employees.id, { onDelete: 'cascade' })
      .notNull(),
    leaveType: varchar('leave_type', { length: 12 }).$type<LeaveType>().notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    status: varchar('status', { length: 12 }).$type<LeaveStatus>().notNull().default('PENDING'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tstz('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_leave_requests_status').on(t.status),
    index('idx_leave_requests_employee').on(t.employeeId),
  ]
);
// SQL (0003): CHECK (to_date >= from_date); EXCLUDE approved leave overlap.

export type PayrollRunStatus = 'DRAFT' | 'FINALIZED' | 'PAID';

/**
 * Where an employee is paid. The account number is stored encrypted (AES-256-GCM); only the last
 * four digits are kept in clear for display. Never returned or logged in full.
 */
export const employeeBankDetails = pgTable('employee_bank_details', {
  employeeId: uuid('employee_id')
    .primaryKey()
    .references(() => employees.id, { onDelete: 'cascade' }),
  accountHolder: varchar('account_holder', { length: 128 }).notNull(),
  accountNumberEnc: text('account_number_enc').notNull(),
  accountLast4: varchar('account_last4', { length: 4 }).notNull(),
  ifsc: varchar('ifsc', { length: 11 }).notNull(),
  bankName: varchar('bank_name', { length: 64 }),
  upiId: varchar('upi_id', { length: 64 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: tstz('updated_at').defaultNow().notNull(),
});

/** One payroll run per calendar month (`month` = YYYY-MM). DRAFT can be edited; FINALIZED and PAID are frozen. */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: pk(),
    month: varchar('month', { length: 7 }).notNull().unique(),
    status: varchar('status', { length: 10 }).$type<PayrollRunStatus>().notNull().default('DRAFT'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    finalizedAt: tstz('finalized_at'),
    paidAt: tstz('paid_at'),
  },
  (t) => [index('idx_payroll_runs_status').on(t.status)]
);

/** An employee's pay for a run. Names and salary are snapshots so a payslip never changes after the fact. */
export const payslips = pgTable(
  'payslips',
  {
    id: pk(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    employeeName: varchar('employee_name', { length: 255 }).notNull(),
    position: varchar('position', { length: 64 }).notNull(),
    department: varchar('department', { length: 24 }).notNull(),
    monthlySalaryPaise: paise('monthly_salary_paise').notNull(),
    daysInMonth: smallint('days_in_month').notNull(),
    payableDays: smallint('payable_days').notNull(),
    basePaise: paise('base_paise').notNull(),
    unpaidLeaveDays: smallint('unpaid_leave_days').notNull().default(0),
    leaveDeductionPaise: paise('leave_deduction_paise').notNull().default(0),
    bonusPaise: paise('bonus_paise').notNull().default(0),
    otherDeductionPaise: paise('other_deduction_paise').notNull().default(0),
    netPaise: paise('net_paise').notNull(),
    approvedLeaveDays: smallint('approved_leave_days').notNull().default(0),
    shiftsScheduled: smallint('shifts_scheduled').notNull().default(0),
    shiftsWorked: smallint('shifts_worked').notNull().default(0),
    note: varchar('note', { length: 500 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('uq_payslips_run_employee').on(t.runId, t.employeeId), index('idx_payslips_employee').on(t.employeeId)]
);
