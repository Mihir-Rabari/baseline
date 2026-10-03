import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHrMock } from '@/lib/mock-hr';
import ShiftsPage from '@/app/(app)/shifts/page';
const doubles = vi.hoisted(() => ({ permissions: new Set<string>(), api: { shifts: vi.fn(), currentShift: vi.fn(), employees: vi.fn(), createShift: vi.fn(), deleteShift: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn() } }));
vi.mock('@/lib/hr-api', () => ({ hrApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: (permission: string) => doubles.permissions.has(permission) }) }));
beforeEach(() => {
  vi.clearAllMocks(); doubles.permissions = new Set(['shifts:read', 'shifts:manage', 'shifts:clock:self', 'hr:read']);
  const state = createHrMock();
  doubles.api.shifts.mockImplementation((params, own) => Promise.resolve(state.shifts(params, own)));
  doubles.api.currentShift.mockImplementation(() => Promise.resolve(state.currentShift()));
  doubles.api.employees.mockImplementation(() => Promise.resolve(state.employees()));
  doubles.api.createShift.mockImplementation((data) => Promise.resolve(state.createShift(data)));
  doubles.api.deleteShift.mockImplementation((id) => Promise.resolve(state.deleteShift(id)));
  doubles.api.clockIn.mockImplementation((id) => Promise.resolve(state.clock(id)));
  doubles.api.clockOut.mockImplementation((id) => Promise.resolve(state.clock(id, true)));
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ShiftsPage /></QueryClientProvider>);
}
describe('Shift workflow', () => {
  it('schedules using IST instants and prevents an end before the start', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Schedule shift' }));
    const dialog = await screen.findByRole('dialog');
    const start = await within(dialog).findByLabelText('Start (IST)');
    fireEvent.change(start, { target: { value: '2030-10-01T12:00' } });
    fireEvent.change(within(dialog).getByLabelText('End (IST)'), { target: { value: '2030-10-01T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule shift' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('endsAt must be after startsAt'));
    expect(doubles.api.createShift).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('End (IST)'), { target: { value: '2030-10-01T20:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule shift' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(doubles.api.createShift).toHaveBeenCalledWith(expect.objectContaining({ startsAt: '2030-10-01T06:30:00.000Z', endsAt: '2030-10-01T14:30:00.000Z' }));
    expect(doubles.api.createShift).toHaveBeenCalledTimes(1);
  });
  it('shows staff their own shift, clocks it in and out, and hides owner actions', async () => {
    doubles.permissions = new Set(['shifts:read', 'shifts:clock:self']); mount();
    expect(screen.queryByRole('button', { name: 'Schedule shift' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Clock in' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clock out' }));
    await screen.findByText('No current shift. Ask the owner to check your schedule.');
    expect(doubles.api.clockIn).toHaveBeenCalledTimes(1); expect(doubles.api.clockOut).toHaveBeenCalledTimes(1);
    expect(doubles.api.employees).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
