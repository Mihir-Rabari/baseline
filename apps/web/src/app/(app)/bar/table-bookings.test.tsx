import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BarTable } from '@packages/validation';
import BarFloorPage from './page';

const T1 = '11111111-1111-4111-8111-111111111111';
const state = vi.hoisted(() => ({ put: vi.fn(), post: vi.fn(), bookings: [] as unknown[] }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'staff-1' }, hasPermission: () => true }),
}));
vi.mock('@/hooks/use-bar', () => ({
  useBarTables: () => ({
    canRead: true,
    canManage: true,
    open: { reset: vi.fn(), isPending: false, isError: false, mutateAsync: vi.fn() },
    tables: { isPending: false, isError: false, refetch: vi.fn(), data: [{ id: T1, name: 'T1', seats: 4, isActive: true, status: 'FREE', openTab: null }] as BarTable[] },
  }),
}));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: () => ({ data: state.bookings, isPending: false, error: null, refetch: vi.fn() }),
  useOpsMutation: (method: string) => ({ isPending: false, mutateAsync: method === 'post' ? state.post : state.put }),
}));
vi.mock('@/components/club/member-search', () => ({ MemberSearch: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const booking = (status: string) => ({
  id: 'b1', tableId: T1, tableName: 'T1', guestName: 'Asha', memberId: null, partySize: 2, notes: null, status,
  startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(),
});

describe('/bar table bookings', () => {
  beforeEach(() => {
    state.put.mockReset().mockResolvedValue({});
    state.bookings = [];
  });

  it('renders exactly one table-booking section', () => {
    render(<BarFloorPage />);
    expect(screen.getAllByRole('region', { name: 'Table bookings' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Table bookings' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Book a table' })).toHaveLength(1);
  });

  it('seats a booked guest and opens the tab dialog prefilled with their name', async () => {
    state.bookings = [booking('BOOKED')];
    render(<BarFloorPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Asha/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seat and open tab' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'b1', status: 'SEATED' }));
    expect(await screen.findByLabelText('Guest name')).toHaveValue('Asha');
    expect(screen.getByText(/Open tab · T1/)).toBeInTheDocument();
  });
});
