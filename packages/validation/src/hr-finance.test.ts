import { describe, expect, it } from 'vitest';
import {
  CreateEmployeeRequestSchema,
  CreateInvoiceRequestSchema,
  CreateLeaveRequestSchema,
  CreateShiftRequestSchema,
  EmployeeListQuerySchema,
  PayInvoiceRequestSchema,
  PayrollSummaryQuerySchema,
  TaxSummaryQuerySchema,
  UpdateEmployeeRequestSchema,
} from './index.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('HR request schemas', () => {
  const employee = { fullName: 'Anita', position: 'Coach', department: 'COACHING', monthlySalaryPaise: 4_000_000, hiredOn: '2030-06-01' };

  it('accepts only the known departments and statuses', () => {
    expect(CreateEmployeeRequestSchema.safeParse(employee).success).toBe(true);
    expect(CreateEmployeeRequestSchema.safeParse({ ...employee, department: 'SPACE' }).success).toBe(false);
    expect(UpdateEmployeeRequestSchema.safeParse({ status: 'INACTIVE' }).success).toBe(true);
    expect(UpdateEmployeeRequestSchema.safeParse({ status: 'FIRED' }).success).toBe(false);
    expect(EmployeeListQuerySchema.safeParse({ department: 'BAR', status: 'ACTIVE' }).success).toBe(true);
    expect(EmployeeListQuerySchema.safeParse({ department: 'bar' }).success).toBe(false);
  });

  it('rejects negative or fractional salaries and impossible hire dates', () => {
    for (const bad of [{ monthlySalaryPaise: -1 }, { monthlySalaryPaise: 10.5 }, { hiredOn: '2030-02-30' }, { position: 'x'.repeat(65) }]) {
      expect(CreateEmployeeRequestSchema.safeParse({ ...employee, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('shift role labels fit the 24 character column and end must follow start', () => {
    const shift = { employeeId: id, roleLabel: 'BAR', startsAt: '2031-05-14T10:00:00.000Z', endsAt: '2031-05-14T12:00:00.000Z' };
    expect(CreateShiftRequestSchema.safeParse(shift).success).toBe(true);
    expect(CreateShiftRequestSchema.safeParse({ ...shift, roleLabel: 'x'.repeat(25) }).success).toBe(false);
    expect(CreateShiftRequestSchema.safeParse({ ...shift, endsAt: shift.startsAt }).success).toBe(false);
  });

  it('leave runs forward in time and uses a known type; payroll takes YYYY-MM', () => {
    expect(CreateLeaveRequestSchema.safeParse({ leaveType: 'SICK', fromDate: '2031-05-14', toDate: '2031-05-14' }).success).toBe(true);
    expect(CreateLeaveRequestSchema.safeParse({ leaveType: 'SICK', fromDate: '2031-05-14', toDate: '2031-05-13' }).success).toBe(false);
    expect(CreateLeaveRequestSchema.safeParse({ leaveType: 'HOLIDAY', fromDate: '2031-05-14', toDate: '2031-05-14' }).success).toBe(false);
    expect(PayrollSummaryQuerySchema.safeParse({ month: '2031-05' }).success).toBe(true);
    for (const month of ['2031-13', '2031-5', '202105']) expect(PayrollSummaryQuerySchema.safeParse({ month }).success, month).toBe(false);
  });
});

describe('finance request schemas', () => {
  it('an invoice has exactly one bill-to and between 1 and 50 lines', () => {
    const lines = [{ description: 'Court', qty: 1, unitPricePaise: 100 }];
    expect(CreateInvoiceRequestSchema.safeParse({ memberId: id, lines }).success).toBe(true);
    expect(CreateInvoiceRequestSchema.safeParse({ businessClientId: id, lines }).success).toBe(true);
    expect(CreateInvoiceRequestSchema.safeParse({ lines }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId: id, businessClientId: id, lines }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId: id, lines: [] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ memberId: id, lines: Array.from({ length: 51 }, () => lines[0]) }).success).toBe(false);
  });

  it('payments are positive whole paise with a known method', () => {
    expect(PayInvoiceRequestSchema.safeParse({ method: 'UPI' }).success).toBe(true);
    for (const bad of [{ method: 'UPI', amountPaise: 0 }, { method: 'UPI', amountPaise: 1.5 }, { method: 'CHEQUE' }]) {
      expect(PayInvoiceRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('the tax summary needs both dates in order', () => {
    expect(TaxSummaryQuerySchema.safeParse({ from: '2033-05-01', to: '2033-05-31' }).success).toBe(true);
    expect(TaxSummaryQuerySchema.safeParse({ from: '2033-05-31', to: '2033-05-01' }).success).toBe(false);
    expect(TaxSummaryQuerySchema.safeParse({ from: '2033-05-01' }).success).toBe(false);
  });
});
