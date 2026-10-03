import { pgTable, varchar, text, uuid, date, index } from 'drizzle-orm/pg-core';
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
