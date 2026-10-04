import { z } from 'zod';
import { UuidSchema, EmailSchema, IsoDateTimeSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import { DateOnlySchema, PaiseSchema, NonNegativePaiseSchema, PersonRefSchema } from './domain-common.js';
import { PhoneSchema } from './members.js';
import { ImageRefSchema } from './uploads.js';

export const DepartmentEnum = z.enum(['FRONT_DESK', 'BAR', 'MAINTENANCE', 'COACHING', 'MANAGEMENT']);
export type DepartmentCode = z.infer<typeof DepartmentEnum>;
export const EmployeeStatusEnum = z.enum(['ACTIVE', 'INACTIVE']);
export type EmployeeStatus = z.infer<typeof EmployeeStatusEnum>;

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
    // `staff_shifts.role_label` is varchar(24): a longer label would be a database error, not a 400.
    roleLabel: z.string().trim().min(1).max(24),
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
  photoUrl: z.string().nullable().optional(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

/** GET /hr/employees/:id: the profile screen. Bank details are a separate, masked call. */
export const EmployeeProfileSchema = EmployeeSchema.extend({
  email: z.string().nullable(),
  phone: z.string().nullable(),
  pendingLeaveRequests: z.number().int().min(0),
});
export type EmployeeProfile = z.infer<typeof EmployeeProfileSchema>;
export const EmployeeListSchema = z.array(EmployeeSchema);

/** GET /hr/employees */
export const EmployeeListQuerySchema = z.object({
  department: DepartmentEnum.optional(),
  status: EmployeeStatusEnum.optional(),
  q: z.string().trim().optional(),
});
export type EmployeeListQuery = z.infer<typeof EmployeeListQuerySchema>;

/** POST /hr/employees */
export const CreateEmployeeRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: EmailSchema.optional(),
  phone: PhoneSchema.optional(),
  position: z.string().trim().min(1).max(64),
  department: DepartmentEnum,
  monthlySalaryPaise: NonNegativePaiseSchema,
  hiredOn: DateOnlySchema,
  userId: UuidSchema.optional(),
  /** One of our uploads or an https link; null removes the photo. */
  photoUrl: ImageRefSchema.nullable().optional(),
});
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequestSchema>;

/** PUT /hr/employees/:id: any subset, plus status. */
export const UpdateEmployeeRequestSchema = CreateEmployeeRequestSchema.partial().extend({
  status: EmployeeStatusEnum.optional(),
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

// ---- Bank details (masked in every response) ----

export const IfscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, for example HDFC0001234');

/** PUT /hr/employees/:id/bank */
export const UpdateBankDetailsRequestSchema = z.object({
  accountHolder: z.string().trim().min(1).max(128),
  accountNumber: z.string().trim().regex(/^\d{6,18}$/, 'Account numbers have 6 to 18 digits'),
  ifsc: IfscSchema,
  bankName: z.string().trim().max(64).optional(),
  upiId: z
    .string()
    .trim()
    .max(64)
    .regex(/^[\w.-]{2,}@[A-Za-z]{2,}$/, 'Enter a valid UPI id, for example name@bank')
    .optional(),
});
export type UpdateBankDetailsRequest = z.infer<typeof UpdateBankDetailsRequestSchema>;

/** GET/PUT /hr/employees/:id/bank: the account number is only ever shown as its last four digits. */
export const BankDetailsSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    accountHolder: z.string(),
    accountNumberMasked: z.string(),
    ifsc: z.string(),
    bankName: z.string().nullable(),
    upiId: z.string().nullable(),
    updatedAt: IsoDateTimeOutSchema,
  }),
]);
export type BankDetails = z.infer<typeof BankDetailsSchema>;

// ---- Payroll runs and payslips ----

export const PayrollRunStatusEnum = z.enum(['DRAFT', 'FINALIZED', 'PAID']);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatusEnum>;

/** POST /hr/payroll/runs */
export const CreatePayrollRunRequestSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month in YYYY-MM format'),
});
export type CreatePayrollRunRequest = z.infer<typeof CreatePayrollRunRequestSchema>;

export const PayslipSchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  month: z.string(),
  employeeId: UuidSchema,
  employeeName: z.string(),
  position: z.string(),
  department: z.string(),
  monthlySalaryPaise: PaiseSchema,
  daysInMonth: z.number().int(),
  payableDays: z.number().int(),
  basePaise: PaiseSchema,
  unpaidLeaveDays: z.number().int().min(0),
  leaveDeductionPaise: PaiseSchema,
  bonusPaise: PaiseSchema,
  otherDeductionPaise: PaiseSchema,
  netPaise: PaiseSchema,
  approvedLeaveDays: z.number().int().min(0),
  shiftsScheduled: z.number().int().min(0),
  shiftsWorked: z.number().int().min(0),
  note: z.string().nullable(),
  bankConfigured: z.boolean(),
});
export type Payslip = z.infer<typeof PayslipSchema>;
export const PayslipListSchema = z.array(PayslipSchema);

/** PUT /hr/payroll/slips/:id: adjustments while the run is still a draft. */
export const UpdatePayslipRequestSchema = z.object({
  unpaidLeaveDays: z.number().int().min(0).max(31).optional(),
  bonusPaise: z.number().int().min(0).max(100_000_000).optional(),
  otherDeductionPaise: z.number().int().min(0).max(100_000_000).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type UpdatePayslipRequest = z.infer<typeof UpdatePayslipRequestSchema>;

export const PayrollRunSchema = z.object({
  id: UuidSchema,
  month: z.string(),
  status: PayrollRunStatusEnum,
  headcount: z.number().int().min(0),
  totalNetPaise: PaiseSchema,
  createdAt: IsoDateTimeOutSchema,
  finalizedAt: NullableIsoDateTimeOutSchema,
  paidAt: NullableIsoDateTimeOutSchema,
});
export type PayrollRun = z.infer<typeof PayrollRunSchema>;
export const PayrollRunListSchema = z.array(PayrollRunSchema);

export const PayrollRunDetailSchema = PayrollRunSchema.extend({ payslips: PayslipListSchema });
export type PayrollRunDetail = z.infer<typeof PayrollRunDetailSchema>;

// ---- Employee documents ----

export const EmployeeDocumentTypeEnum = z.enum(['ID_PROOF', 'ADDRESS_PROOF', 'CONTRACT', 'CERTIFICATE', 'OTHER']);
export type EmployeeDocumentType = z.infer<typeof EmployeeDocumentTypeEnum>;

/** Documents are PDFs or JPEG/PNG/WebP scans, at most 10 MB. */
export const EMPLOYEE_DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_EMPLOYEE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_EMPLOYEE = 25;

export const EmployeeDocumentSchema = z.object({
  id: UuidSchema,
  employeeId: UuidSchema,
  docType: EmployeeDocumentTypeEnum,
  fileName: z.string(),
  contentType: z.enum(EMPLOYEE_DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().positive(),
  uploadedAt: IsoDateTimeOutSchema,
});
export type EmployeeDocument = z.infer<typeof EmployeeDocumentSchema>;
export const EmployeeDocumentListSchema = z.array(EmployeeDocumentSchema);

/** POST /hr/employees/:id/documents?docType=&fileName= (the file is the raw request body). */
export const UploadEmployeeDocumentQuerySchema = z.object({
  docType: EmployeeDocumentTypeEnum,
  // A display name only. It is never used as a path; the stored key is generated.
  fileName: z.string().trim().min(1).max(120),
});
export type UploadEmployeeDocumentQuery = z.infer<typeof UploadEmployeeDocumentQuerySchema>;
