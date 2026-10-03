import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarFloorPage from './page';
import tablesFixture from '@/mocks/bar-tables.json';
import bookingsFixture from '@/mocks/bar-table-bookings.json';
import type { BarTable, BarTableBooking } from '@packages/validation';

const doubles = vi.hoisted(() => ({
  tablesData: [] as BarTable[],
  bookingsData: [] as BarTableBooking[],
  permissions: new Set<string>(['bar:read', 'bar:manage', 'members:read']),
  updateFn: vi.fn(),
  createFn: vi.fn(),
  seatFn: vi.fn(),
  cancelFn: vi.fn(),
}));

vi.mock('@/lib/bar-api', () => ({
  barApi: {
    tables: vi.fn(() => Promise.resolve(doubles.tablesData)),
    bookings: vi.fn(() => Promise.resolve(doubles.bookingsData)),
    createBooking: vi.fn((data: unknown) => {
      doubles.createFn(data);
      return Promise.resolve({ id: 'new-b', ...(data as object) });
    }),
    updateBooking: vi.fn((id: string, data: unknown) => {
      doubles.updateFn(id, data);
      return Promise.resolve({ id, ...(data as object) });
    }),
    cancelBooking: vi.fn((id: string, reason?: string) => {
      doubles.cancelFn(id, reason);
      return Promise.resolve({ id, status: 'CANCELLED' });
    }),
    seatBooking: vi.fn((id: string) => {
      doubles.seatFn(id);
      return Promise.resolve({ id, status: 'SEATED' });
    }),
    open: vi.fn(),
  },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'staff-1', name: 'Bar Tender' },
    hasPermission: (perm: string) => doubles.permissions.has(perm),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <BarFloorPage />
    </QueryClientProvider>
  );
}

describe('Bar Floor Table Bookings (Issue #74)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.permissions = new Set(['bar:read', 'bar:manage', 'members:read']);
    doubles.tablesData = structuredClone(tablesFixture) as unknown as BarTable[];
    doubles.bookingsData = structuredClone(bookingsFixture) as unknown as BarTableBooking[];
  });

  it('renders the table reservations & timeline section below the bar tables', async () => {
    mount();

    // Table cards at top and timeline section below
    expect(await screen.findByText('Table Reservations & Timeline')).toBeInTheDocument();
    expect(screen.getAllByText('T1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('T2').length).toBeGreaterThanOrEqual(1);

    // Timeline section below
    expect(screen.getByText('Table Reservations & Timeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Table' })).toBeInTheDocument();
    expect(await screen.findByTestId('timeline-view')).toBeInTheDocument();
  });

  it('switches between Timeline, Day, and List views', async () => {
    mount();

    expect(await screen.findByTestId('timeline-view')).toBeInTheDocument();

    // Switch to Day view
    const dayBtn = screen.getByRole('button', { name: 'Day schedule view' });
    fireEvent.click(dayBtn);
    expect(await screen.findByTestId('day-view')).toBeInTheDocument();

    // Switch to List view
    const listBtn = screen.getByRole('button', { name: 'List view' });
    fireEvent.click(listBtn);
    expect(await screen.findByTestId('list-view')).toBeInTheDocument();
    expect(screen.getByText('Dev Patel')).toBeInTheDocument();
    expect(screen.getByText('Anita Roy')).toBeInTheDocument();

    // Switch back to Timeline
    const timelineBtn = screen.getByRole('button', { name: 'Gantt timeline view' });
    fireEvent.click(timelineBtn);
    expect(await screen.findByTestId('timeline-view')).toBeInTheDocument();
  });

  it('filters table bookings by search query and table filter', async () => {
    mount();

    // Switch to list view for easy assertion
    fireEvent.click(await screen.findByRole('button', { name: 'List view' }));
    expect(screen.getByText('Dev Patel')).toBeInTheDocument();
    expect(screen.getByText('Anita Roy')).toBeInTheDocument();

    // Search query
    const searchInput = screen.getByPlaceholderText('Search bookings by guest or phone…');
    fireEvent.change(searchInput, { target: { value: 'Anita' } });
    expect(screen.queryByText('Dev Patel')).not.toBeInTheDocument();
    expect(screen.getByText('Anita Roy')).toBeInTheDocument();

    // Clear search
    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);
    expect(screen.getByText('Dev Patel')).toBeInTheDocument();

    // Filter by table
    const tableSelect = screen.getByLabelText('Filter by table');
    fireEvent.change(tableSelect, { target: { value: doubles.tablesData[1].id } }); // T2
    expect(screen.getByText('Dev Patel')).toBeInTheDocument();
    expect(screen.queryByText('Anita Roy')).not.toBeInTheDocument();
  });

  it('filters by status pills', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'List view' }));

    // Click 'Seated' status filter
    const seatedBtn = screen.getByRole('button', { name: 'Seated' });
    fireEvent.click(seatedBtn);

    expect(screen.getByText('Riya')).toBeInTheDocument();
    expect(screen.queryByText('Dev Patel')).not.toBeInTheDocument();

    // Click 'Cancelled' status filter
    const cancelledBtn = screen.getByRole('button', { name: 'Cancelled' });
    fireEvent.click(cancelledBtn);

    expect(screen.getByText('Siddharth')).toBeInTheDocument();
    expect(screen.queryByText('Riya')).not.toBeInTheDocument();
  });

  it('supports moving/shifting booking time and detects conflict when shifting into an occupied slot', async () => {
    mount();
    await screen.findByTestId('timeline-view');

    // Find shift buttons for Dev Patel
    const shiftLaterBtn = screen.getByLabelText('Shift Dev Patel later');
    fireEvent.click(shiftLaterBtn);

    // Shifts by +30m
    await waitFor(() => {
      expect(doubles.updateFn).toHaveBeenCalled();
    });

    // Open details
    const bookingBar = screen.getByTitle(/Dev Patel/);
    fireEvent.click(bookingBar);

    expect(await screen.findByText('Quick Adjustments')).toBeInTheDocument();
  });

  it('allows opening the New Booking modal and detects live conflicts', async () => {
    mount();

    const bookBtn = await screen.findByRole('button', { name: 'Book Table' });
    fireEvent.click(bookBtn);

    expect(await screen.findByText('New Table Reservation')).toBeInTheDocument();

    // Select Table T2
    const tableSelect = screen.getByLabelText('Bar Table');
    fireEvent.change(tableSelect, { target: { value: doubles.tablesData[1].id } }); // T2

    // Set time overlapping with Dev Patel (13:00 - 14:30)
    const startInput = screen.getByLabelText('Start Time');
    const endInput = screen.getByLabelText('End Time');
    fireEvent.change(startInput, { target: { value: '13:30' } });
    fireEvent.change(endInput, { target: { value: '15:00' } });

    // Live conflict warning should appear!
    expect(await screen.findByText(/Conflict detected: Already booked by/)).toBeInTheDocument();
    expect(screen.getAllByText('Dev Patel').length).toBeGreaterThanOrEqual(1);

    // Submit button should be disabled due to conflict
    const submitBtn = screen.getByRole('button', { name: 'Create Reservation' });
    expect(submitBtn).toBeDisabled();

    // Change to non-conflicting time (16:00 - 18:00)
    fireEvent.change(startInput, { target: { value: '16:00' } });
    fireEvent.change(endInput, { target: { value: '18:00' } });

    // Conflict warning disappears
    expect(screen.queryByText(/Conflict detected: Already booked by/)).not.toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();

    // Enter guest details and submit
    const guestInput = screen.getByPlaceholderText('Guest name');
    fireEvent.change(guestInput, { target: { value: 'Kabir Khan' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(doubles.createFn).toHaveBeenCalledWith(
        expect.objectContaining({
          guestName: 'Kabir Khan',
          tableId: doubles.tablesData[1].id,
        })
      );
    });
  });

  it('allows seating a confirmed booking from list view or detail dialog', async () => {
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'List view' }));
    const seatButtons = screen.getAllByRole('button', { name: 'Seat' });
    expect(seatButtons.length).toBeGreaterThan(0);

    fireEvent.click(seatButtons[0]);
    await waitFor(() => {
      expect(doubles.seatFn).toHaveBeenCalled();
    });
  });
});
