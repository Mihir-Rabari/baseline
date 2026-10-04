import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KitchenPage from './page';
import { barApi } from '@/lib/bar-api';
import type { Ticket } from '@packages/validation';

const authState = vi.hoisted(() => ({
  user: { id: 'staff-1', fullName: 'Chef Gordon' },
  canKitchen: true,
  canBar: true,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: authState.user,
    hasPermission: (perm: string) =>
      perm === 'bar:kitchen' ? authState.canKitchen : perm === 'bar:read' ? authState.canBar : false,
  }),
}));

vi.mock('@/lib/bar-api', () => ({
  barApi: {
    tickets: vi.fn(),
    advance: vi.fn(),
  },
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <KitchenPage />
    </QueryClientProvider>
  );
}

describe('Kitchen & Bar Display Page (Issue #79)', () => {
  const sampleTickets: Ticket[] = [
    {
      id: 'ticket-1',
      ticketNumber: 201,
      station: 'KITCHEN',
      status: 'NEW',
      minutesWaiting: 3,
      table: { name: 'Table 1' },
      tab: { id: 'tab-1', tabNumber: 10, label: 'Table 1 · Rohit Sharma' },
      items: [
        { name: 'Margherita Pizza', qty: 1, note: 'thin crust' },
      ],
      createdAt: '2026-10-04T12:00:00.000Z',
    },
    {
      id: 'ticket-2',
      ticketNumber: 202,
      station: 'BAR',
      status: 'PREPARING',
      minutesWaiting: 8,
      table: { name: 'T2' },
      tab: { id: 'tab-2', tabNumber: 12, label: 'T2 · Priya Patel' },
      items: [
        { name: 'Cold Coffee', qty: 2, note: null },
      ],
      createdAt: '2026-10-04T11:55:00.000Z',
    },
    {
      id: 'ticket-3',
      ticketNumber: 203,
      station: 'KITCHEN',
      status: 'READY',
      minutesWaiting: 15,
      table: null, // Walk-in
      tab: { id: 'tab-3', tabNumber: 15, label: 'Walk-in · Amit Verma' },
      items: [
        { name: 'Veg Hakka Noodles', qty: 1, note: 'extra spicy' },
      ],
      createdAt: '2026-10-04T11:45:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    authState.user = { id: 'staff-1', fullName: 'Chef Gordon' };
    authState.canKitchen = true;
    authState.canBar = true;
    vi.mocked(barApi.tickets).mockResolvedValue(structuredClone(sampleTickets));
    vi.mocked(barApi.advance).mockResolvedValue({} as any);
  });

  it('renders ticket columns and all tickets', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Kitchen & Bar Tickets' })).toBeInTheDocument();
    expect(screen.getByText('Cold Coffee')).toBeInTheDocument();
    expect(screen.getByText('Veg Hakka Noodles')).toBeInTheDocument();

    // Column headers
    expect(screen.getByRole('region', { name: 'New' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Preparing' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ready' })).toBeInTheDocument();
  });

  it('filters tickets in real-time by search query (order/item/table)', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText('Search tickets');

    // Search by item name
    fireEvent.change(searchInput, { target: { value: 'Pizza' } });
    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    expect(screen.queryByText('Cold Coffee')).not.toBeInTheDocument();
    expect(screen.queryByText('Veg Hakka Noodles')).not.toBeInTheDocument();

    // Search by table name
    fireEvent.change(searchInput, { target: { value: 'T2' } });
    expect(screen.getByText('Cold Coffee')).toBeInTheDocument();
    expect(screen.queryByText('Margherita Pizza')).not.toBeInTheDocument();

    // Clear search button
    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);
    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    expect(screen.getByText('Cold Coffee')).toBeInTheDocument();
  });

  it('filters tickets by station (Kitchen vs Bar)', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    });

    // Switch to Bar station
    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
    expect(screen.getByText('Cold Coffee')).toBeInTheDocument();
    expect(screen.queryByText('Margherita Pizza')).not.toBeInTheDocument();
    expect(screen.queryByText('Veg Hakka Noodles')).not.toBeInTheDocument();

    // Switch to Kitchen station
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    expect(screen.getByText('Veg Hakka Noodles')).toBeInTheDocument();
    expect(screen.queryByText('Cold Coffee')).not.toBeInTheDocument();
  });

  it('filters by status stage and isolates column', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    });

    const statusSelect = screen.getByLabelText('Filter by status');
    fireEvent.change(statusSelect, { target: { value: 'READY' } });

    // Only Ready column is visible
    expect(screen.getByRole('region', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'New' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Preparing' })).not.toBeInTheDocument();
    expect(screen.getByText('Veg Hakka Noodles')).toBeInTheDocument();
  });

  it('filters by wait time and highlights urgent tickets', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    });

    const timeSelect = screen.getByLabelText('Filter by wait time');
    // Filter over 10 min (urgent)
    fireEvent.change(timeSelect, { target: { value: 'OVER_10' } });
    expect(screen.getByText('Veg Hakka Noodles')).toBeInTheDocument();
    expect(screen.queryByText('Margherita Pizza')).not.toBeInTheDocument();
    expect(screen.queryByText('Cold Coffee')).not.toBeInTheDocument();
  });

  it('resets all filters using the reset button', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    });

    // Apply multiple filters
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'Pizza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));

    expect(screen.getByRole('button', { name: 'Reset all filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset all filters' }));

    // All tickets restored
    expect(screen.getByText('Margherita Pizza')).toBeInTheDocument();
    expect(screen.getByText('Cold Coffee')).toBeInTheDocument();
    expect(screen.getByText('Veg Hakka Noodles')).toBeInTheDocument();
  });

  it('advances a ticket status when the action button is clicked', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start ticket 201' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start ticket 201' }));
    await waitFor(() => {
      expect(barApi.advance).toHaveBeenCalledWith('ticket-1', { status: 'PREPARING' });
    });
  });
});
