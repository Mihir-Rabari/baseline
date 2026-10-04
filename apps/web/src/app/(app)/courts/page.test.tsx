import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema } from '@packages/validation';
import { ApiError } from '@/lib/api-client';
import fixture from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';
import CourtsPage from './page';
import { chooseDate, chooseOption, daysFromToday } from '@/test-utils/ui';

const state = vi.hoisted(() => ({
  staff: false, read: true, book: true,
  data: undefined as unknown, error: null as Error | null, pending: false, fetching: false,
  refetch: vi.fn(), mutation: vi.fn(), reset: vi.fn(), submitting: false, query: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'self' }, hasPermission: (action: string) =>
  action === 'bookings:create' ? state.staff : action === 'bookings:create:self' ? state.book : action === 'bookings:read:self' ? state.read : false }) }));
vi.mock('@/hooks/use-availability', () => ({
  useAvailability: (params: unknown, enabled: boolean) => { state.query(params, enabled); return { data: state.data, error: state.error, isPending: state.pending, isFetching: state.fetching, refetch: state.refetch }; },
  useCreateBooking: () => ({ mutateAsync: state.mutation, isPending: state.submitting, reset: state.reset }),
  useMemberLookup: () => ({ data: [], isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function chooseFree() { fireEvent.click(screen.getByRole('button', { name: 'Tennis Court 1, 8:30 am, ₹600' })); }
function guest() {
  fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'Riya Patel' } });
  fireEvent.change(screen.getByLabelText('Guest phone'), { target: { value: '9876543210' } });
}
describe('booking calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { staff: false, read: true, book: true, data: AvailabilitySchema.parse(fixture), error: null, pending: false, fetching: false, submitting: false });
    state.mutation.mockResolvedValue({ court: { name: 'Tennis Court 1' }, startsAt: fixture.courts[0].slots[0].startsAt });
  });
  it('opens checkout dialog for member, pays in full via UPI and clears selection', async () => {
    render(<CourtsPage />); chooseFree();
    fireEvent.click(screen.getByRole('button', { name: 'Book court' }));
    expect(screen.getByRole('heading', { name: 'Court checkout' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹600' }));
    await waitFor(() => expect(state.mutation).toHaveBeenCalledWith({ social: false, data: { courtId: fixture.courts[0].courtId, startsAt: fixture.courts[0].slots[0].startsAt, channel: 'ONLINE', payNow: { method: 'UPI' } } }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Guest name')).not.toBeInTheDocument();
  });
  it('allows member to pay 20% promise fee in cash via checkout dialog', async () => {
    render(<CourtsPage />); chooseFree();
    fireEvent.click(screen.getByRole('button', { name: 'Book court' }));
    expect(screen.getByRole('heading', { name: 'Court checkout' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cash'));
    expect(screen.getByText(/20% promise fee/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹120' }));
    await waitFor(() => expect(state.mutation).toHaveBeenCalledWith({ social: false, data: { courtId: fixture.courts[0].courtId, startsAt: fixture.courts[0].slots[0].startsAt, channel: 'ONLINE', payNow: { method: 'CASH' } } }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument());
  });
  it('validates walk-in details, retries and includes immediate payment for staff', async () => {
    state.staff = true; render(<CourtsPage />); chooseFree();
    fireEvent.click(screen.getByRole('button', { name: 'Book court' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Check the guest'));
    expect(state.mutation).not.toHaveBeenCalled(); guest();
    await chooseOption('Payment', 'UPI now');
    fireEvent.click(screen.getByRole('button', { name: 'Book court' }));
    await waitFor(() => expect(state.mutation).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guest: { name: 'Riya Patel', phone: '9876543210' }, payNow: { method: 'UPI' }, channel: 'DESK' }) })));
  });
  it('clears selection on a date, sport or participant change', async () => {
    state.staff = true; render(<CourtsPage />); chooseFree();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Padel' }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Tennis Court 1' })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'All courts' }), { button: 0, ctrlKey: false }); chooseFree();
    await chooseDate('Date', daysFromToday(14));
    expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument();
    chooseFree(); await chooseOption('Booking for', 'Member');
    expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument();
  });
  it('joins social sessions without payment fields', async () => {
    state.data = AvailabilitySchema.parse(friday); render(<CourtsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /Tennis Court 1.*3 of 8 left/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Join session' }));
    await waitFor(() => expect(state.mutation).toHaveBeenCalledWith({ social: true, data: { courtId: friday.courts[0].courtId, startsAt: friday.courts[0].slots[0].startsAt } }));
  });
  it('refetches and clears a slot lost to a concurrent booking', async () => {
    state.mutation.mockRejectedValue(new ApiError('Taken', 409, 'SLOT_TAKEN'));
    render(<CourtsPage />); chooseFree();
    fireEvent.click(screen.getByRole('button', { name: 'Book court' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹600' }));
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument();
  });
  it('shows daily-limit errors and prevents booking when quota is already used', async () => {
    state.mutation.mockRejectedValue(new ApiError('Daily quota reached', 422, 'DAILY_LIMIT_REACHED'));
    const { rerender } = render(<CourtsPage />); chooseFree();
    fireEvent.click(screen.getByRole('button', { name: 'Book court' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₹600' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Daily quota reached'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    state.data = { ...fixture, limits: { usedToday: 2, maxPerDay: 2 } }; rerender(<CourtsPage />);
    expect(screen.getByRole('button', { name: 'Book court' })).toBeDisabled();
  });
  it('blocks confirmation while submitting, fetching new prices or after a slot becomes occupied', () => {
    const { rerender } = render(<CourtsPage />); chooseFree();
    state.fetching = true; rerender(<CourtsPage />); expect(screen.getByRole('button', { name: 'Book court' })).toBeDisabled();
    state.fetching = false; state.submitting = true; rerender(<CourtsPage />); expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled();
    expect(screen.getByLabelText('Date')).toBeDisabled();
    state.submitting = false;
    const data = structuredClone(fixture); data.courts[0].slots[0].status = 'BOOKED'; state.data = data; rerender(<CourtsPage />);
    expect(screen.getByText('That session is no longer available. Choose another time.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book court' })).not.toBeInTheDocument();
  });
  it('handles loading, empty and error states and does not query without read access', () => {
    state.pending = true; state.data = undefined;
    const { rerender } = render(<CourtsPage />); expect(screen.getByRole('status', { name: 'Loading court availability' })).toBeInTheDocument();
    state.pending = false; state.data = { ...fixture, courts: [] }; rerender(<CourtsPage />); expect(screen.getByText('No court sessions available')).toBeInTheDocument();
    state.error = new Error('Network unavailable'); rerender(<CourtsPage />); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(state.refetch).toHaveBeenCalledOnce();
    state.read = false; state.book = false; rerender(<CourtsPage />); expect(screen.getByText('Court booking is unavailable')).toBeInTheDocument();
    expect(state.query).toHaveBeenLastCalledWith(expect.anything(), false);
  });
});
