import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ticketsFixture from '@/mocks/bar-tickets.json';
import KitchenPage from './page';
import { filterTickets } from '@/lib/kitchen-filter';
import type { Ticket } from '@packages/validation';

const doubles = vi.hoisted(() => ({
  api: {
    tickets: vi.fn(),
    advance: vi.fn(),
  },
  permissions: new Set<string>(['bar:read', 'bar:kitchen']),
}));

vi.mock('@/lib/bar-api', () => ({
  barApi: doubles.api,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'staff-1', fullName: 'Staff User' },
    hasPermission: (perm: string) => doubles.permissions.has(perm),
  }),
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

describe('Kitchen Page (Issue #79: Search and Filters)', () => {
  const sampleTickets = structuredClone(ticketsFixture) as unknown as Ticket[];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    doubles.permissions = new Set(['bar:read', 'bar:kitchen']);
    doubles.api.tickets.mockResolvedValue(structuredClone(sampleTickets));
    doubles.api.advance.mockResolvedValue({});
  });

  it('renders all tickets categorized into New, Preparing, and Ready columns', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: /New/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Preparing/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Ready/ })).toBeInTheDocument();
    expect(screen.getByText(/T1 · #60/)).toBeInTheDocument();
    expect(screen.getByText(/T2 · #61/)).toBeInTheDocument();
  });

  it('filters tickets by item name or special note search', async () => {
    mount();
    await screen.findByText(/T1 · #60/, {}, { timeout: 5000 });
    const searchInput = screen.getByLabelText('Search tickets');

    // Search by item name
    fireEvent.change(searchInput, { target: { value: 'Cold coffee' } });
    expect(screen.getByText(/T2 · #61/)).toBeInTheDocument();
    expect(screen.queryByText(/T1 · #60/)).not.toBeInTheDocument();

    // Search by note
    fireEvent.change(searchInput, { target: { value: 'Less salt' } });
    expect(screen.getByText(/T1 · #60/)).toBeInTheDocument();
    expect(screen.queryByText(/T2 · #61/)).not.toBeInTheDocument();

    // Clear search
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText(/T2 · #61/)).toBeInTheDocument();
  });

  it('filters tickets by ticket number, tab number, and table name', async () => {
    mount();
    await screen.findByText(/T1 · #60/, {}, { timeout: 5000 });
    const searchInput = screen.getByLabelText('Search tickets');

    // Search by ticket number
    fireEvent.change(searchInput, { target: { value: '63' } });
    expect(screen.getByText(/T4 · #63/)).toBeInTheDocument();
    expect(screen.queryByText(/T1 · #60/)).not.toBeInTheDocument();

    // Search by table name
    fireEvent.change(searchInput, { target: { value: 'T5' } });
    expect(screen.getByText(/T5 · #64/)).toBeInTheDocument();
    expect(screen.queryByText(/T4 · #63/)).not.toBeInTheDocument();
  });

  it('filters tickets by station (Kitchen vs Bar)', async () => {
    mount();
    await screen.findByText(/T1 · #60/, {}, { timeout: 5000 });

    // Switch to Bar only
    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
    // Bar tickets: #61 (T2), #63 (T4), #65 (T6)
    expect(screen.getByText(/T2 · #61/)).toBeInTheDocument();
    expect(screen.getByText(/T4 · #63/)).toBeInTheDocument();
    expect(screen.queryByText(/T1 · #60/)).not.toBeInTheDocument();

    // Switch to Kitchen only
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    // Kitchen tickets: #60 (T1), #62 (T3), #64 (T5)
    expect(screen.getByText(/T1 · #60/)).toBeInTheDocument();
    expect(screen.getByText(/T3 · #62/)).toBeInTheDocument();
    expect(screen.queryByText(/T2 · #61/)).not.toBeInTheDocument();
  });

  it('filters tickets by waiting time (Urgent / 10+ min)', async () => {
    mount();
    await screen.findByText(/T1 · #60/, {}, { timeout: 5000 });

    const timeSelect = screen.getByLabelText('Filter by wait time');
    fireEvent.change(timeSelect, { target: { value: 'OVER_10' } });

    // Tickets waiting >= 10 min: #63 (12m), #64 (15m), #65 (18m)
    expect(screen.getByText(/T4 · #63/)).toBeInTheDocument();
    expect(screen.getByText(/T5 · #64/)).toBeInTheDocument();
    expect(screen.queryByText(/T1 · #60/)).not.toBeInTheDocument(); // 3m
    expect(screen.queryByText(/T2 · #61/)).not.toBeInTheDocument(); // 6m
  });

  it('resets all filters using the Reset Filters button', async () => {
    mount();
    await screen.findByText(/T1 · #60/, {}, { timeout: 5000 });

    const searchInput = screen.getByLabelText('Search tickets');
    fireEvent.change(searchInput, { target: { value: 'Nonexistent Item' } });

    // Should display empty filtered state
    expect(screen.getByText('No matching tickets')).toBeInTheDocument();

    // Click clear / reset
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(screen.getByText(/T1 · #60/)).toBeInTheDocument();
  });

  it('persists filters to localStorage and reloads them', async () => {
    window.localStorage.setItem(
      'bar:kitchen:filters:v1',
      JSON.stringify({ query: 'Iced tea', station: 'KITCHEN', status: 'ALL', time: 'ALL', channel: 'ALL' })
    );

    mount();
    await screen.findByText(/T5 · #64/, {}, { timeout: 5000 });
    expect(screen.getByText(/T5 · #64/)).toBeInTheDocument();
    expect(screen.queryByText(/T1 · #60/)).not.toBeInTheDocument();

    // Verify input value reflects stored query
    const input = screen.getByLabelText('Search tickets') as HTMLInputElement;
    expect(input.value).toBe('Iced tea');
  });

  it('advances ticket status through Start, Mark ready, and Mark served', async () => {
    mount();
    await screen.findByText(/T1 · #60/, {}, { timeout: 5000 });

    const startBtn = screen.getByRole('button', { name: 'Start ticket 60' });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(doubles.api.advance).toHaveBeenCalledWith('b0000000-0000-4000-8000-000000000300', {
        status: 'PREPARING',
      });
    });
  });

  it('pure filterTickets function correctly filters across all dimensions', () => {
    const res1 = filterTickets(sampleTickets, {
      query: '',
      station: 'BAR',
      status: 'ALL',
      time: 'ALL',
      channel: 'ALL',
    });
    expect(res1.every((t) => t.station === 'BAR')).toBe(true);

    const res2 = filterTickets(sampleTickets, {
      query: 'orange',
      station: 'ALL',
      status: 'ALL',
      time: 'ALL',
      channel: 'ALL',
    });
    expect(res2.length).toBe(1);
    expect(res2[0].ticketNumber).toBe(63);

    const res3 = filterTickets(sampleTickets, {
      query: '',
      station: 'ALL',
      status: 'ALL',
      time: 'UNDER_5',
      channel: 'ALL',
    });
    expect(res3.every((t) => t.minutesWaiting < 5)).toBe(true);
  });
});
