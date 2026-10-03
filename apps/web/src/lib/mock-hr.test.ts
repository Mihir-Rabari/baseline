import { describe, expect, it } from 'vitest';
import { EmployeeSchema, ShiftSchema, LeaveRequestSchema, PayrollSummarySchema } from '@packages/validation';
import { createHrMock } from './mock-hr';

describe('Staff mocks', () => {
  it('creates an employee and changes payroll only for active employees', () => {
    const state = createHrMock(); const before = state.payroll('2026-11');
    const employee = state.createEmployee({ fullName: 'New coach', department: 'COACHING', position: 'Coach', monthlySalaryPaise: 4200000, hiredOn: '2026-10-01' });
    expect(EmployeeSchema.safeParse(employee).success).toBe(true);
    expect(state.payroll('2026-11').totalPaise - before.totalPaise).toBe(4200000);
    state.updateEmployee(employee.id, { status: 'INACTIVE' });
    expect(state.payroll('2026-11').totalPaise).toBe(before.totalPaise);
    expect(PayrollSummarySchema.safeParse(state.payroll('2026-11')).success).toBe(true);
  });
  it('enforces half-open shift overlaps, rejects invalid ordering and supports adjacent shifts', () => {
    const state = createHrMock(); const employeeId = state.employees()[0].id;
    const first = state.createShift({ employeeId, roleLabel: 'BAR', startsAt: '2030-10-01T06:30:00Z', endsAt: '2030-10-01T14:30:00Z' });
    expect(ShiftSchema.safeParse(first).success).toBe(true);
    expect(() => state.createShift({ employeeId, roleLabel: 'BAR', startsAt: '2030-10-01T13:30:00Z', endsAt: '2030-10-01T16:30:00Z' })).toThrow('overlapping');
    const second = state.createShift({ employeeId, roleLabel: 'BAR', startsAt: '2030-10-01T14:30:00Z', endsAt: '2030-10-01T16:30:00Z' });
    expect(state.shifts({ from: '2030-10-01', to: '2030-10-01' })).toHaveLength(2);
    expect(() => state.createShift({ employeeId, roleLabel: 'BAR', startsAt: '2030-10-01T14:30:00Z', endsAt: '2030-10-01T12:30:00Z' })).toThrow();
    state.deleteShift(second.id);
    expect(state.shifts({ from: '2030-10-01', to: '2030-10-01' })).toHaveLength(1);
  });
  it('clocks only the current employee and rejects duplicate clock operations', () => {
    const state = createHrMock(); const shift = state.currentShift()!;
    expect(shift).not.toBeNull();
    const another = state.shifts().find((row) => row.employee.id !== shift.employee.id)!;
    expect(() => state.clock(another.id)).toThrow('only clock your own');
    expect(() => state.clock(shift.id, true)).toThrow('already changed');
    expect(state.clock(shift.id).status).toBe('ON_SHIFT');
    expect(() => state.clock(shift.id)).toThrow('already changed');
    expect(() => state.deleteShift(shift.id)).toThrow('has started');
    expect(state.clock(shift.id, true).status).toBe('DONE');
    expect(state.currentShift()).toBeNull();
  });
  it('requests inclusive leave, prevents duplicate dates and decisions, and updates payroll leave', () => {
    const state = createHrMock();
    const row = state.requestLeave({ leaveType: 'PAID', fromDate: '2030-11-03', toDate: '2030-11-05', reason: 'Family trip' });
    expect(row.days).toBe(3);
    expect(LeaveRequestSchema.safeParse(row).success).toBe(true);
    expect(() => state.requestLeave({ leaveType: 'SICK', fromDate: '2030-11-05', toDate: '2030-11-06' })).toThrow('already have leave');
    state.decide(row.id, { decision: 'APPROVED' });
    expect(() => state.decide(row.id, { decision: 'REJECTED' })).toThrow('already been decided');
    expect(state.payroll('2030-11').onLeave).toContainEqual({ employeeName: row.employee.fullName, fromDate: row.fromDate, toDate: row.toDate });
    expect(state.leave(1, true).data.every((item) => item.employee.id === row.employee.id)).toBe(true);
  });
});
