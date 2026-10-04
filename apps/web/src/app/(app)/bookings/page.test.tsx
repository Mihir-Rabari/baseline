import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import BookingsPage from './page';

const HOUR = 3600000;
const state = vi.hoisted(() => ({
  staff: false, mine: undefined as unknown, day: undefined as unknown, error: null as Error | null, pending: false,
  scope: vi.fn(), date: vi.fn(), cancel: vi.fn(), refetch: vi.fn(), cancelling: false,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' }, hasPermission: (action: string) => action === 'bookings:read' && state.staff }) }));
vi.mock('@/hooks/use-bookings', () => ({
  useMyBookings: (scope: string) => { state.scope(scope); return { data: state.mine, error: state.error, isPending: state.pending, refetch: state.refetch }; },
  useDayBookings: (date: string) => { state.date(date); return { data: state.day, error: state.error, isPending: state.pending, refetch: state.refetch }; },
  useWeekBookings: () => ({ data: state.day, error: state.error, isPending: state.pending, refetch: state.refetch }),
  useCancelBooking: () => ({ mutateAsync: state.cancel, isPending: state.cancelling }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function booking(id: string, hoursFromNow: number, extra: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + hoursFromNow * HOUR);
  return { id, court: { id: 'c1', name: 'Tennis Court 1', type: 'TENNIS' }, kind: 'STANDARD', member: { id: 'm1', memberCode: 'CC-1', fullName: 'Aarav Mehta', planCode: 'GOLD' }, guest: null,
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + HOUR).toISOString(), bookingDate: '2026-10-09', status: 'CONFIRMED', cancelledLate: false,
    channel: 'ONLINE', basePricePaise: 60000, discountPct: 0, pricePaise: 60000, paidPaise: 0, paymentStatus: 'UNPAID', socialSessionId: null, createdAt: start.toISOString(), ...extra };
}
const page = (rows: unknown[]) => ({ data: rows, meta: { page: 1, limit: 100, totalItems: rows.length, totalPages: 1, hasNextPage: false, hasPrevPage: false } });

describe('bookings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { staff: false, error: null, pending: false, cancelling: false, mine: page([booking('b1', 30), booking('b2', 1)]), day: page([]) });
    state.cancel.mockResolvedValue({ late: false });
  });

  it('lists upcoming bookings with a cancel action and switches to the past tab', () => {
    render(<BookingsPage />);
    expect(screen.getAllByRole('button', { name: /^Cancel Tennis Court 1/ })).toHaveLength(2);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Past' }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    expect(state.scope).toHaveBeenLastCalledWith('past');
    expect(screen.queryByRole('button', { name: /^Cancel Tennis/ })).not.toBeInTheDocument();
  });

  it('explains the free window and cancels the chosen booking', async () => {
    render(<BookingsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Cancel Tennis Court 1/ })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Free to cancel until 2 hours before');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(state.cancel).toHaveBeenCalledWith({ id: 'b1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('warns about no refund inside the 2-hour cutoff', () => {
    render(<BookingsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Cancel Tennis Court 1/ })[1]);
    expect(screen.getByRole('dialog')).toHaveTextContent('no refund');
    expect(screen.getByRole('dialog')).toHaveTextContent('starts within 2 hours');
  });

  it('keeps the dialog open and shows the server message when cancelling fails', async () => {
    state.cancel.mockRejectedValue(new ApiError('Only confirmed bookings can be cancelled.', 409, 'NOT_CANCELLABLE'));
    render(<BookingsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Cancel Tennis Court 1/ })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Only confirmed bookings can be cancelled.'));
  });

  it('keep booking closes the dialog without cancelling', () => {
    render(<BookingsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Cancel Tennis Court 1/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep booking' }));
    expect(state.cancel).not.toHaveBeenCalled();
  });

  it('renders loading, empty and error states', () => {
    state.pending = true;
    const { rerender } = render(<BookingsPage />);
    expect(screen.getByRole('status', { name: 'Loading bookings' })).toBeInTheDocument();
    state.pending = false; state.mine = page([]); rerender(<BookingsPage />);
    expect(screen.getByText('No upcoming bookings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/courts');
    state.error = new Error('Service unavailable'); rerender(<BookingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it('shows staff the day view with who each booking is for', () => {
    state.staff = true; state.day = page([booking('b3', 5, { member: null, guest: { name: 'Riya Patel', phone: '9876543210' } })]);
    render(<BookingsPage />);
    expect(screen.getByRole('heading', { name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
    expect(screen.getByText('Riya Patel')).toBeInTheDocument();
    expect(state.scope).not.toHaveBeenCalled();
  });

  it('does not offer cancel for bookings that are not confirmed', () => {
    state.mine = page([booking('b4', 30, { status: 'CANCELLED' })]);
    render(<BookingsPage />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel Tennis/ })).not.toBeInTheDocument();
  });
});
