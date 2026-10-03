import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarTable, TableBooking } from '@packages/validation';
import { TableBookings } from './table-bookings';
import { clubInstant } from '@/lib/table-bookings';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const DATE = '2030-03-10';
const state = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), bookings: [] as unknown[], toastError: vi.fn() }));

vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: () => ({ data: state.bookings, isPending: false, error: null, refetch: vi.fn() }),
  useOpsMutation: (method: string) => ({ isPending: false, mutateAsync: method === 'post' ? state.post : state.put }),
}));
vi.mock('@/lib/booking-calendar', async (orig) => ({ ...(await orig<typeof import('@/lib/booking-calendar')>()), calendarDate: () => '2030-03-10' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: state.toastError } }));

const tables: BarTable[] = [
  { id: T1, name: 'T1', seats: 4, isActive: true, status: 'FREE', openTab: null },
  { id: T2, name: 'T2', seats: 6, isActive: true, status: 'FREE', openTab: null },
  { id: '33333333-3333-4333-8333-333333333333', name: 'T9', seats: 2, isActive: false, status: 'FREE', openTab: null },
] as BarTable[];

const at = (h: number, m = 0) => new Date(clubInstant(DATE, h * 60 + m)).toISOString();
const booking = (id: string, tableId: string, guestName: string, from: [number, number?], to: [number, number?], status: TableBooking['status'] = 'BOOKED'): TableBooking => ({
  id, tableId, tableName: tableId === T1 ? 'T1' : 'T2', guestName, memberId: null, partySize: 4, notes: null, status,
  startsAt: at(from[0], from[1] ?? 0), endsAt: at(to[0], to[1] ?? 0),
});

describe('table bookings', () => {
  beforeEach(() => {
    state.post.mockReset().mockResolvedValue({});
    state.put.mockReset().mockResolvedValue({});
    state.toastError.mockReset();
    state.bookings = [booking('b1', T1, 'Asha', [18], [20]), booking('b2', T1, 'Ravi', [20], [21]), booking('b3', T2, 'Meera', [19], [21], 'SEATED')];
  });

  it('draws one row per active table with a bar per booking and no row for switched-off tables', () => {
    render(<TableBookings tables={tables} canManage />);
    expect(screen.getByTestId('track-T1')).toBeInTheDocument();
    expect(screen.getByTestId('track-T2')).toBeInTheDocument();
    expect(screen.queryByTestId('track-T9')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('track-T1')).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Meera.*Seated/ })).toBeInTheDocument();
  });

  it('moves a booking 15 minutes with the arrow keys and sends the new times', async () => {
    render(<TableBookings tables={tables} canManage />);
    const bar = screen.getByRole('button', { name: /^Ravi/ });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'b2', tableId: T1, startsAt: at(20, 15), endsAt: at(21, 15) }));
  });

  it('resizes with shift and an arrow, and moves between tables with up and down', async () => {
    render(<TableBookings tables={tables} canManage />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Ravi/ }), { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'b2', tableId: T1, startsAt: at(20), endsAt: at(21, 15) }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^Asha/ }), { key: 'ArrowDown' });
    // Asha 18:00 to 20:00 on T2 collides with Meera 19:00 to 21:00, so nothing is sent.
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith(expect.stringContaining('already booked for Meera')));
    expect(state.put).toHaveBeenCalledTimes(1);
  });

  it('refuses an overlapping move without calling the server', () => {
    render(<TableBookings tables={tables} canManage />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Asha/ }), { key: 'ArrowRight', shiftKey: true }); // would end 20:15, over Ravi
    expect(state.put).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalledWith(expect.stringContaining('already booked for Ravi'));
  });

  it('does not let a read-only viewer move, resize or book', () => {
    render(<TableBookings tables={tables} canManage={false} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Ravi/ }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByTestId('track-T1'));
    expect(state.put).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Book a table' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('books from an empty slot, validating before it posts', async () => {
    render(<TableBookings tables={tables} canManage />);
    fireEvent.click(screen.getByTestId('track-T2'));
    fireEvent.click(screen.getByRole('button', { name: 'Book table' }));
    await screen.findByText('Enter the guest name.');
    expect(state.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'Kabir' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book table' }));
    await screen.findByText('The booking must end after it starts.');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book table' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith(expect.objectContaining({ tableId: T2, guestName: 'Kabir', partySize: 2, startsAt: at(13), endsAt: at(14, 30) })));
  });

  it('shows the server reason when the booking is refused', async () => {
    state.post.mockRejectedValue(new Error('That table is already booked for Asha'));
    render(<TableBookings tables={tables} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Book a table' }));
    fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'Late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book table' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already booked for Asha');
  });

  it('opens a booking to seat the guest or cancel it', async () => {
    render(<TableBookings tables={tables} canManage />);
    fireEvent.click(screen.getByRole('button', { name: /^Asha/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seat guest' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'b1', status: 'SEATED' }));
  });

  it('switches to a list of the day, in time order, and back', () => {
    render(<TableBookings tables={tables} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('row', { name: /Asha/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Meera.*Seated/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByTestId('track-T1')).toBeInTheDocument();
  });

  it('shows an empty-day message in the list view', () => {
    state.bookings = [];
    render(<TableBookings tables={tables} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('No bookings for this day.')).toBeInTheDocument();
  });
});
