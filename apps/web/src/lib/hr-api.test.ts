import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHrMock } from './mock-hr';
const transport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ USE_MOCKS: false, fetchApi: transport, mock: (data: unknown) => Promise.resolve(data) }));
import { hrApi } from './hr-api';
beforeEach(() => transport.mockReset());
describe('Staff real transport', () => {
  it('calls versioned employee routes with exact request bodies', async () => {
    const state = createHrMock(); transport.mockResolvedValue(state.employees()); await hrApi.employees();
    expect(transport).toHaveBeenLastCalledWith('/api/v1/hr/employees');
    const data = { fullName: 'Coach', position: 'Coach', department: 'COACHING', monthlySalaryPaise: 100000, hiredOn: '2026-10-01' };
    transport.mockResolvedValue(state.employees()[0]); await hrApi.createEmployee(data);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/hr/employees', { method: 'POST', body: JSON.stringify(data) });
    await hrApi.updateEmployee('id/one', { status: 'INACTIVE' });
    expect(transport).toHaveBeenLastCalledWith('/api/v1/hr/employees/id%2Fone', { method: 'PUT', body: '{"status":"INACTIVE"}' });
  });
  it('uses own-session shift routes and encodes mutation IDs', async () => {
    const state = createHrMock(); transport.mockResolvedValue(state.currentShift()); await hrApi.currentShift();
    expect(transport).toHaveBeenLastCalledWith('/api/v1/me/shift/current');
    await hrApi.clockIn('shift/one'); expect(transport).toHaveBeenLastCalledWith('/api/v1/shifts/shift%2Fone/clock-in', { method: 'POST' });
    await hrApi.clockOut('shift/one'); expect(transport).toHaveBeenLastCalledWith('/api/v1/shifts/shift%2Fone/clock-out', { method: 'POST' });
    transport.mockResolvedValue(state.shifts()); await hrApi.shifts({ from: '2026-10-01', to: '2026-10-03' }, true);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/shifts?from=2026-10-01&to=2026-10-03');
    const data = { employeeId: state.employees()[0].id, roleLabel: 'BAR', startsAt: '2030-10-01T06:30:00Z', endsAt: '2030-10-01T14:30:00Z' };
    transport.mockResolvedValue(state.shifts()[0]); await hrApi.createShift(data);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/shifts', { method: 'POST', body: JSON.stringify(data) });
    transport.mockResolvedValue({ success: true, message: 'Removed' }); await hrApi.deleteShift('shift/one');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/shifts/shift%2Fone', { method: 'DELETE' });
  });
  it('binds leave decisions, self requests and payroll to contract endpoints', async () => {
    const state = createHrMock(); transport.mockResolvedValue(state.leave()); await hrApi.leave(1, false, 'PENDING');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/hr/leave?page=1&limit=20&status=PENDING');
    await hrApi.leave(1, true); expect(transport).toHaveBeenLastCalledWith('/api/v1/me/leave?page=1&limit=20');
    transport.mockResolvedValue(state.leave().data[0]); await hrApi.decide('id/one', { decision: 'APPROVED' });
    expect(transport).toHaveBeenLastCalledWith('/api/v1/hr/leave/id%2Fone/decision', { method: 'POST', body: '{"decision":"APPROVED"}' });
    const data = { leaveType: 'CASUAL' as const, fromDate: '2026-12-01', toDate: '2026-12-02' };
    await hrApi.requestLeave(data); expect(transport).toHaveBeenLastCalledWith('/api/v1/me/leave', { method: 'POST', body: JSON.stringify(data) });
    transport.mockResolvedValue(state.payroll('2026-10')); await hrApi.payroll('2026-10');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/hr/payroll-summary?month=2026-10');
  });
});
