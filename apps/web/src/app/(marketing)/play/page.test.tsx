import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAvailability } from '@/lib/booking-api';
import PlayPage from './page';
const state = vi.hoisted(() => ({ guestBook: vi.fn(), data: undefined as unknown }));
vi.mock('@/hooks/use-public-availability', () => ({ usePublicAvailability: () => ({ data: state.data, isPending: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/use-plans', () => ({ usePublicClub: () => ({ data: undefined }) }));
vi.mock('@/lib/booking-api', async (original) => ({ ...await original<typeof import('@/lib/booking-api')>(), bookingApi: { guestBook: state.guestBook } }));
function mount() { return render(<QueryClientProvider client={new QueryClient()}><PlayPage /></QueryClientProvider>); }
function open() { fireEvent.click(screen.getAllByRole('button').find((button) => button.getAttribute('aria-label')?.startsWith('Tennis') && !button.hasAttribute('disabled'))!); }
describe('Guest checkout', () => {
  beforeEach(() => { state.data = mockAvailability({ date: '2099-01-01' }, true); state.guestBook.mockReset().mockResolvedValue({ booking: {}, paidPaise: 60000, duePaise: 0, message: 'Booked and paid. See you on court.' }); });
  const fill = () => { fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Riya' } }); fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } }); };
  it('validates, then pays by UPI by default and shows the confirmation', async () => {
    mount(); open();
    fireEvent.click(screen.getByRole('button', { name: /^Pay .* and book$/ }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(state.guestBook).not.toHaveBeenCalled();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /^Pay .* and book$/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Booked and paid'));
    expect(state.guestBook).toHaveBeenCalledWith(expect.objectContaining({ email: undefined, name: 'Riya', method: 'UPI' }));
  });
  it('card pays in full; cash shows the 20% promise fee and the amount due at the club', async () => {
    mount(); open(); fill();
    fireEvent.click(screen.getByLabelText('Card'));
    expect(screen.getByText('Paid in full now.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cash'));
    expect(screen.getByText(/A 20% promise fee holds your booking/)).toBeInTheDocument();
    expect(screen.getByText('Pay later')).toBeInTheDocument();
    state.guestBook.mockResolvedValue({ booking: {}, paidPaise: 12000, duePaise: 48000, message: 'Booked. Pay the rest at the club.' });
    fireEvent.click(screen.getByRole('button', { name: /^Pay .* and book$/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Due at the club'));
    expect(state.guestBook).toHaveBeenCalledWith(expect.objectContaining({ method: 'CASH' }));
  });
  it('shows the server error when the slot was just taken and keeps the form', async () => {
    state.guestBook.mockRejectedValue(Object.assign(new Error('That slot is taken'), { code: 'SLOT_TAKEN' }));
    mount(); open(); fill();
    fireEvent.click(screen.getByRole('button', { name: /^Pay .* and book$/ }));
    await waitFor(() => expect(state.guestBook).toHaveBeenCalled());
    expect(screen.getByLabelText('Name')).toHaveValue('Riya');
  });
});
