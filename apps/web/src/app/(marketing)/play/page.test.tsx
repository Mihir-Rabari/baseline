import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAvailability } from '@/lib/booking-api';
import PlayPage from './page';
const state = vi.hoisted(() => ({ trial: vi.fn(), data: undefined as unknown }));
vi.mock('@/hooks/use-public-availability', () => ({ usePublicAvailability: () => ({ data: state.data, isPending: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/use-plans', () => ({ usePublicClub: () => ({ data: undefined }) }));
vi.mock('@/lib/booking-api', async (original) => ({ ...await original<typeof import('@/lib/booking-api')>(), bookingApi: { trial: state.trial } }));
function mount() { return render(<QueryClientProvider client={new QueryClient()}><PlayPage /></QueryClientProvider>); }
function open() { fireEvent.click(screen.getAllByRole('button').find((button) => button.getAttribute('aria-label')?.startsWith('Tennis') && !button.hasAttribute('disabled'))!); }
describe('Public trial', () => {
  beforeEach(() => { state.data = mockAvailability({ date: '2099-01-01' }, true); state.trial.mockReset().mockResolvedValue({}); });
  it('validates then submits phone-only with no blank email and shows confirmation', async () => {
    mount(); open(); fireEvent.click(screen.getByRole('button', { name: 'Book trial' })); await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)); expect(state.trial).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Riya' } }); fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } }); fireEvent.click(screen.getByRole('button', { name: 'Book trial' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Trial booked'));
    expect(state.trial).toHaveBeenCalledWith(expect.objectContaining({ email: undefined, name: 'Riya' }));
  });
  it('shows reused trial error on the phone field', async () => {
    state.trial.mockRejectedValue(Object.assign(new Error('Trial already used'), { code: 'TRIAL_ALREADY_USED' })); mount(); open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Riya' } }); fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } }); fireEvent.click(screen.getByRole('button', { name: 'Book trial' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Trial already used'));
  });
});
