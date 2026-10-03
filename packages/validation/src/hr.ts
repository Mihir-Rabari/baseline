import { z } from 'zod';
import { UuidSchema, EmailSchema, IsoDateTimeSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import { DateOnlySchema, PaiseSchema, NonNegativePaiseSchema, PersonRefSchema } from './domain-common.js';
import { PhoneSchema } from './members.js';

// ---- Shifts (API_CONTRACT 8) ----

export const ShiftStatusEnum = z.enum(['SCHEDULED', 'ON_SHIFT', 'DONE', 'MISSED']);
export type ShiftStatus = z.infer<typeof ShiftStatusEnum>;

export const ShiftSchema = z.object({
  id: UuidSchema,
  employee: z.object({ id: UuidSchema, fullName: z.string() }),
  roleLabel: z.string(),
  startsAt: IsoDateTimeOutSchema,
  endsAt: IsoDateTimeOutSchema,
  clockInAt: NullableIsoDateTimeOutSchema,
  clockOutAt: NullableIsoDateTimeOutSchema,
  status: ShiftStatusEnum,
});
export type Shift = z.infer<typeof ShiftSchema>;
export const ShiftListSchema = z.array(ShiftSchema);

/** GET /me/shift/current */
export const CurrentShiftSchema = ShiftSchema.nullable();

/** GET /shifts */
export const ShiftListQuerySchema = z.object({
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  employeeId: UuidSchema.optional(),
});
export type ShiftListQuery = z.infer<typeof ShiftListQuerySchema>;

/** POST /shifts */
export const CreateShiftRequestSchema = z
  .object({
    employeeId: UuidSchema,
    roleLabel: z.string().trim().min(1).max(100),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type CreateShiftRequest = z.infer<typeof CreateShiftRequestSchema>;

// ---- Employees (10.3) ----

export const EmployeeSchema = z.object({
  id: UuidSchema,
  fullName: z.string(),
  position: z.string(),
  department: z.string(),
  monthlySalaryPaise: PaiseSchema,
  hiredOn: DateOnlySchema,
  status: z.string(),
  leaveDaysThisYear: z.number().int().min(0),
});
export type Employee = z.infer<typeof EmployeeSchema>;
export const EmployeeListSchema = z.array(EmployeeSchema);

/** GET /hr/employees */
export const EmployeeListQuerySchema = z.object({
  department: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  q: z.string().trim().optional(),
});
export type EmployeeListQuery = z.infer<typeof EmployeeListQuerySchema>;

/** POST /hr/employees */
export const CreateEmployeeRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: EmailSchema.optional(),
  phone: PhoneSchema.optional(),
  position: z.string().trim().min(1).max(100),
  department: z.string().trim().min(1).max(100),
  monthlySalaryPaise: NonNegativePaiseSchema,
  hiredOn: DateOnlySchema,
  userId: UuidSchema.optional(),
});
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequestSchema>;

/** PUT /hr/employees/:id: any subset, plus status. */
export const UpdateEmployeeRequestSchema = CreateEmployeeRequestSchema.partial().extend({
  status: z.string().trim().min(1).optional(),
});
export type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeRequestSchema>;

// ---- Leave ----

export const LeaveTypeEnum = z.enum(['CASUAL', 'SICK', 'PAID']);
export type LeaveType = z.infer<typeof LeaveTypeEnum>;

export const LeaveStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export type LeaveStatus = z.infer<typeof LeaveStatusEnum>;

export const LeaveRequestSchema = z.object({
  id: UuidSchema,
  employee: z.object({ id: UuidSchema, fullName: z.string() }),
  leaveType: LeaveTypeEnum,
  fromDate: DateOnlySchema,
  toDate: DateOnlySchema,
  days: z.number().int().min(1),
  reason: z.string().nullable(),
  status: LeaveStatusEnum,
  decidedBy: PersonRefSchema.nullable(),
  decidedAt: NullableIsoDateTimeOutSchema,
  decisionNote: z.string().nullable(),
  createdAt: IsoDateTimeOutSchema,
});
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;
export const LeaveRequestPageSchema = createPaginatedResponseSchema(LeaveRequestSchema);

/** GET /hr/leave */
export const LeaveListQuerySchema = PaginationQuerySchema.extend({
  status: LeaveStatusEnum.optional(),
  employeeId: UuidSchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});
export type LeaveListQuery = z.infer<typeof LeaveListQuerySchema>;

/** GET /me/leave */
export const MyLeaveQuerySchema = PaginationQuerySchema.pick({ page: true, limit: true });

/** POST /hr/leave/:id/decision */
export const LeaveDecisionRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional(),
});
export type LeaveDecisionRequest = z.infer<typeof LeaveDecisionRequestSchema>;

/** POST /me/leave */
export const CreateLeaveRequestSchema = z
  .object({
    leaveType: LeaveTypeEnum,
    fromDate: DateOnlySchema,
    toDate: DateOnlySchema,
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: 'toDate must not be before fromDate',
    path: ['toDate'],
  });
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

// ---- Payroll ----

/** GET /hr/payroll-summary */
export const PayrollSummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month in YYYY-MM format'),
});
export type PayrollSummaryQuery = z.infer<typeof PayrollSummaryQuerySchema>;

export const PayrollSummarySchema = z.object({
  month: z.string(),
  totalPaise: PaiseSchema,
  headcount: z.number().int().min(0),
  byDepartment: z.array(
    z.object({ department: z.string(), headcount: z.number().int().min(0), amountPaise: PaiseSchema }),
  ),
  onLeave: z.array(z.object({ employeeName: z.string(), fromDate: DateOnlySchema, toDate: DateOnlySchema })),
});
export type PayrollSummary = z.infer<typeof PayrollSummarySchema>;
