import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema } from '@packages/validation';
import { ApiError } from '@/lib/api-client';
import fixture from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';
import PlayPage from './page';

const state = vi.hoisted(() => ({
  data: undefined as unknown, error: null as Error | null, pending: false, refetch: vi.fn(), query: vi.fn(), trial: vi.fn(), reset: vi.fn(), submitting: false,
}));
vi.mock('@/hooks/use-public-play', () => ({
  usePublicAvailability: (params: unknown) => { state.query(params); return { data: state.data, error: state.error, isPending: state.pending, refetch: state.refetch }; },
  useTrialBooking: () => ({ mutateAsync: state.trial, isPending: state.submitting, reset: state.reset }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const first = fixture.courts[0];
function chooseFree() { fireEvent.click(screen.getByRole('button', { name: 'Tennis Court 1, 8:30 am, ₹600' })); }
function fill(phone = '9876543210') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Riya Patel' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: phone } });
}

describe('public play page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { data: AvailabilitySchema.parse(fixture), error: null, pending: false, submitting: false });
    state.trial.mockResolvedValue({ booking: { court: { name: 'Tennis Court 1' }, startsAt: first.slots[0].startsAt }, leadId: 'lead', message: 'ok' });
  });

  it('shows the read-only grid for the next seven days with no staff or member controls', () => {
    render(<PlayPage />);
    expect(screen.getByRole('heading', { name: 'Play at the club' })).toBeInTheDocument();
    const date = screen.getByLabelText('Date');
    expect(date).toHaveAttribute('max');
    expect(new Date(`${date.getAttribute('max')}T12:00:00Z`).getTime() - new Date(`${date.getAttribute('min')}T12:00:00Z`).getTime()).toBe(6 * 86400000);
    expect(screen.queryByLabelText('Booking for')).not.toBeInTheDocument();
    expect(screen.queryByText('Your session')).not.toBeInTheDocument();
  });

  it('opens a trial dialog for a free slot and confirms the booking with the pay-at-club message', async () => {
    render(<PlayPage />); chooseFree();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Book a trial');
    fill();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book trial' }));
    await waitFor(() => expect(state.trial).toHaveBeenCalledWith({ courtId: first.courtId, startsAt: first.slots[0].startsAt, name: 'Riya Patel', phone: '9876543210', email: undefined }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Trial booked. Pay at the club on arrival.'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates name and phone before calling the API', async () => {
    render(<PlayPage />); chooseFree();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book trial' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(state.trial).not.toHaveBeenCalled();
  });

  it('SLOT_TAKEN toasts, closes the dialog and refetches', async () => {
    state.trial.mockRejectedValue(new ApiError('taken', 409, 'SLOT_TAKEN'));
    render(<PlayPage />); chooseFree(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Book trial' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That slot was just taken. Choose another time.'));
    expect(state.refetch).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('TRIAL_ALREADY_USED puts the error on the phone field and keeps the dialog open', async () => {
    state.trial.mockRejectedValue(new ApiError('used', 409, 'TRIAL_ALREADY_USED'));
    render(<PlayPage />); chooseFree(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Book trial' }));
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('This phone number has already used a free trial.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not let visitors pick social sessions or booked cells', () => {
    state.data = AvailabilitySchema.parse(friday);
    render(<PlayPage />);
    const social = screen.getAllByRole('button').filter((button) => /left$/.test(button.getAttribute('aria-label') ?? ''));
    expect(social.length).toBeGreaterThan(0);
    for (const button of social) expect(button).toBeDisabled();
  });

  it('renders loading, error with retry and the closed-day state', () => {
    state.pending = true;
    const { rerender } = render(<PlayPage />);
    expect(screen.getByRole('status', { name: 'Loading court availability' })).toBeInTheDocument();
    state.pending = false; state.error = new Error('Service unavailable'); rerender(<PlayPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledOnce();
    state.error = null; state.data = { ...AvailabilitySchema.parse(fixture), courts: AvailabilitySchema.parse(fixture).courts.map((c) => ({ ...c, slots: [] })) }; rerender(<PlayPage />);
    expect(screen.getByText('Courts are closed on this day')).toBeInTheDocument();
  });
});
