import {
  EmployeeListSchema, ShiftListSchema, LeaveRequestSchema, CreateEmployeeRequestSchema,
  CreateShiftRequestSchema, CreateLeaveRequestSchema, LeaveDecisionRequestSchema, UpdateEmployeeRequestSchema,
  type CreateEmployeeRequest, type UpdateEmployeeRequest, type CreateShiftRequest,
  type CreateLeaveRequest, type LeaveDecisionRequest, type LeaveRequest, type PayrollSummary,
  type ShiftListQuery,
} from '@packages/validation';
import employeesFixture from '@/mocks/employees.json';
import shiftsFixture from '@/mocks/shifts.json';
import leaveFixture from '@/mocks/leave.json';

const copy = <T,>(value: T): T => structuredClone(value);
export class HrMockError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const overlap = (start: string, end: string, otherStart: string, otherEnd: string) => start <= otherEnd && otherStart <= end;
export function createHrMock() {
  const employees = EmployeeListSchema.parse(employeesFixture);
  // Demo shifts follow the current session so clock-in remains usable after
  // the checked-in fixture's calendar day has passed.
  const shifts = ShiftListSchema.parse(shiftsFixture).map((shift) => ({ ...shift,
    startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 7 * 3600000).toISOString() }));
  const leaves = leaveFixture.map((item) => LeaveRequestSchema.parse(item));
  const ownEmployee = employees[0];
  const employee = (id: string) => {
    const row = employees.find((item) => item.id === id);
    if (!row) throw new HrMockError('NOT_FOUND', 'This employee was not found.');
    return row;
  };
  return {
    employees: () => copy(employees),
    createEmployee(input: CreateEmployeeRequest) {
      const data = CreateEmployeeRequestSchema.parse(input);
      const row = { id: crypto.randomUUID(), fullName: data.fullName, position: data.position,
        department: data.department, monthlySalaryPaise: data.monthlySalaryPaise, hiredOn: data.hiredOn, status: 'ACTIVE', leaveDaysThisYear: 0 };
      employees.push(row); return copy(row);
    },
    updateEmployee(id: string, input: UpdateEmployeeRequest) {
      const row = employee(id); Object.assign(row, UpdateEmployeeRequestSchema.parse(input)); return copy(row);
    },
    shifts(params: ShiftListQuery = {}, own = false) {
      return copy(shifts.filter((item) => (!own || item.employee.id === ownEmployee.id)
        && (!params.employeeId || item.employee.id === params.employeeId)
        && (!params.from || Date.parse(item.endsAt) >= Date.parse(`${params.from}T00:00:00+05:30`))
        && (!params.to || Date.parse(item.startsAt) <= Date.parse(`${params.to}T23:59:59+05:30`))));
    },
    createShift(input: CreateShiftRequest) {
      const data = CreateShiftRequestSchema.parse(input); const staff = employee(data.employeeId);
      if (shifts.some((item) => item.employee.id === staff.id && Date.parse(item.startsAt) < Date.parse(data.endsAt) && Date.parse(data.startsAt) < Date.parse(item.endsAt))) {
        throw new HrMockError('SHIFT_OVERLAP', 'This employee already has an overlapping shift.');
      }
      const row = { id: crypto.randomUUID(), employee: { id: staff.id, fullName: staff.fullName },
        roleLabel: data.roleLabel, startsAt: data.startsAt, endsAt: data.endsAt, clockInAt: null, clockOutAt: null, status: 'SCHEDULED' as const };
      shifts.push(row); return copy(row);
    },
    deleteShift(id: string) {
      const index = shifts.findIndex((item) => item.id === id);
      if (index < 0) throw new HrMockError('NOT_FOUND', 'This shift was not found.');
      if (shifts[index].clockInAt) throw new HrMockError('SHIFT_STARTED', 'A shift that has started cannot be deleted.');
      shifts.splice(index, 1); return { success: true, message: 'Shift removed' };
    },
    currentShift() {
      const now = Date.now();
      return copy(shifts.find((item) => item.employee.id === ownEmployee.id && !item.clockOutAt && Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now) ?? null);
    },
    clock(id: string, out = false) {
      const shift = shifts.find((item) => item.id === id);
      if (!shift) throw new HrMockError('NOT_FOUND', 'This shift was not found.');
      if (shift.employee.id !== ownEmployee.id) throw new HrMockError('FORBIDDEN', 'You can only clock your own shift.');
      if (out ? !shift.clockInAt || Boolean(shift.clockOutAt) : Boolean(shift.clockInAt)) {
        throw new HrMockError('SHIFT_ALREADY_CHANGED', 'This shift has already changed. Refresh the roster.');
      }
      if (out) { shift.clockOutAt = new Date().toISOString(); shift.status = 'DONE'; }
      else { shift.clockInAt = new Date().toISOString(); shift.status = 'ON_SHIFT'; }
      return copy(shift);
    },
    leave(page = 1, own = false, status?: LeaveRequest['status']) {
      const rows = leaves.filter((row) => (!own || row.employee.id === ownEmployee.id) && (!status || row.status === status));
      const limit = 20; const totalPages = Math.ceil(rows.length / limit);
      return copy({ data: rows.slice((page - 1) * limit, page * limit), meta: { page, limit, totalItems: rows.length,
        totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 } });
    },
    requestLeave(input: CreateLeaveRequest) {
      const data = CreateLeaveRequestSchema.parse(input);
      if (leaves.some((row) => row.employee.id === ownEmployee.id && ['PENDING', 'APPROVED'].includes(row.status) && overlap(data.fromDate, data.toDate, row.fromDate, row.toDate))) {
        throw new HrMockError('LEAVE_OVERLAP', 'You already have leave requested for these dates.');
      }
      const row: LeaveRequest = { id: crypto.randomUUID(), employee: { id: ownEmployee.id, fullName: ownEmployee.fullName },
        leaveType: data.leaveType, fromDate: data.fromDate, toDate: data.toDate,
        days: Math.round((Date.parse(data.toDate) - Date.parse(data.fromDate)) / 86400000) + 1,
        reason: data.reason ?? null, status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date().toISOString() };
      leaves.unshift(row); return copy(row);
    },
    decide(id: string, input: LeaveDecisionRequest) {
      const data = LeaveDecisionRequestSchema.parse(input);
      const row = leaves.find((item) => item.id === id);
      if (!row) throw new HrMockError('NOT_FOUND', 'This leave request was not found.');
      if (row.status !== 'PENDING') throw new HrMockError('ALREADY_DECIDED', 'This request has already been decided.');
      if (data.decision === 'APPROVED' && leaves.some((other) => other.id !== row.id && other.employee.id === row.employee.id && other.status === 'APPROVED' && overlap(row.fromDate, row.toDate, other.fromDate, other.toDate))) {
        throw new HrMockError('LEAVE_OVERLAP', 'Approved leave already overlaps these dates.');
      }
      row.status = data.decision; row.decidedAt = new Date().toISOString(); row.decisionNote = data.note ?? null;
      row.decidedBy = { id: employees[4].id, name: 'Owner' }; return copy(row);
    },
    payroll(month: string): PayrollSummary {
      const active = employees.filter((row) => row.status === 'ACTIVE');
      const departments = [...new Set(active.map((row) => row.department))];
      return { month, headcount: active.length, totalPaise: active.reduce((sum, row) => sum + row.monthlySalaryPaise, 0),
        byDepartment: departments.map((department) => { const rows = active.filter((row) => row.department === department);
          return { department, headcount: rows.length, amountPaise: rows.reduce((sum, row) => sum + row.monthlySalaryPaise, 0) }; }),
        onLeave: leaves.filter((row) => row.status === 'APPROVED' && row.fromDate.slice(0, 7) <= month && row.toDate.slice(0, 7) >= month)
          .map((row) => ({ employeeName: row.employee.fullName, fromDate: row.fromDate, toDate: row.toDate })) };
    },
  };
}
export const hrMock = createHrMock();
