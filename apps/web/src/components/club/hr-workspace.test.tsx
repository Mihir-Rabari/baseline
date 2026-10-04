import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHrMock } from '@/lib/mock-hr';
import { HrWorkspace } from './hr-workspace';
import { chooseDate, daysFromToday } from '@/test-utils/ui';
const doubles = vi.hoisted(() => ({ permissions: new Set<string>(), api: { employees: vi.fn(), leave: vi.fn(), payroll: vi.fn(), createEmployee: vi.fn(), updateEmployee: vi.fn(), requestLeave: vi.fn(), decide: vi.fn() } }));
vi.mock('@/lib/hr-api', () => ({ hrApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: (permission: string) => doubles.permissions.has(permission) }) }));
beforeEach(() => {
  vi.clearAllMocks(); doubles.permissions = new Set(['hr:read', 'hr:manage', 'leave:decide', 'leave:read:self', 'leave:create:self']);
  const state = createHrMock();
  doubles.api.employees.mockImplementation(() => Promise.resolve(state.employees()));
  doubles.api.leave.mockImplementation((page, own, status) => Promise.resolve(state.leave(page, own, status)));
  doubles.api.payroll.mockImplementation((month) => Promise.resolve(state.payroll(month)));
  doubles.api.createEmployee.mockImplementation((data) => Promise.resolve(state.createEmployee(data)));
  doubles.api.updateEmployee.mockImplementation((id, data) => Promise.resolve(state.updateEmployee(id, data)));
  doubles.api.requestLeave.mockImplementation((data) => Promise.resolve(state.requestLeave(data)));
  doubles.api.decide.mockImplementation((id, data) => Promise.resolve(state.decide(id, data)));
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><HrWorkspace /></QueryClientProvider>);
}
describe('Staff workspace', () => {
  it('links each employee to their profile', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Asha Shah' })).toHaveAttribute('href', '/hr/employees/c0000000-0000-4000-8000-000000000001');
  });
  it('creates an employee, converts rupees to paise and refreshes the employee list', async () => {
    mount(); await screen.findByText('Asha Shah');
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Full name'), { target: { value: 'Meera Singh' } });
    fireEvent.change(within(dialog).getByLabelText('Position'), { target: { value: 'Coach' } });
    fireEvent.change(within(dialog).getByLabelText('Monthly salary (₹)'), { target: { value: '42000.50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save employee' }));
    await screen.findByText('Meera Singh');
    expect(doubles.api.createEmployee).toHaveBeenCalledWith(expect.objectContaining({ monthlySalaryPaise: 4200050, fullName: 'Meera Singh' }));
    expect(doubles.api.createEmployee).toHaveBeenCalledTimes(1);
  });
  it('shows only personal leave to staff and validates date ordering before sending', async () => {
    doubles.permissions = new Set(['leave:read:self', 'leave:create:self']); mount();
    expect(screen.queryByRole('tab', { name: 'Employees' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Payroll' })).not.toBeInTheDocument();
    await screen.findByText('Asha Shah');
    expect(doubles.api.employees).not.toHaveBeenCalled();
    expect(doubles.api.payroll).not.toHaveBeenCalled();
    expect(doubles.api.leave).toHaveBeenCalledWith(1, true, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Request leave' }));
    const dialog = await screen.findByRole('dialog');
    await chooseDate('From', daysFromToday(5));
    await chooseDate('To', daysFromToday(3));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request leave' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('toDate must not be before fromDate'));
    expect(doubles.api.requestLeave).not.toHaveBeenCalled();
    await chooseDate('To', daysFromToday(8));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request leave' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(doubles.api.requestLeave).toHaveBeenCalledTimes(1);
  });
});
