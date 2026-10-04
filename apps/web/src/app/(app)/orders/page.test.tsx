import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shopApi } from '@/lib/shop-api';
import OrdersPage from './page';
import { filterOrders } from '@/lib/orders-filter';
import type { Order } from '@packages/validation';

const state = vi.hoisted(() => ({ staff: true, update: true }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'member', fullName: 'Staff User' },
    hasPermission: (permission: string) =>
      permission === 'orders:read' ? state.staff : permission === 'orders:update' ? state.update : true,
  }),
}));

vi.mock('@/lib/shop-api', () => ({
  shopApi: {
    orders: vi.fn(),
    status: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrdersPage />
    </QueryClientProvider>
  );
}

describe('Orders Page & Board Layout (Issue #72)', () => {
  const sampleOrders: Order[] = [
    {
      id: 'order-1',
      orderNumber: 'ORD-001',
      status: 'PLACED',
      fulfilment: 'PICKUP',
      member: { id: 'm-1', memberCode: 'MEM-1', fullName: 'Alice Member' },
      customerName: null,
      items: [{ productId: 'p-1', name: 'Tennis Racket', qty: 1, unitPricePaise: 50000, discountPct: 0, lineTotalPaise: 50000 }],
      totalPaise: 50000,
      channel: 'ONLINE',
      deliveryAddress: null,
      subtotalPaise: 50000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      paymentStatus: 'UNPAID',
      createdAt: '2026-10-03T09:00:00.000Z',
    },
    {
      id: 'order-2',
      orderNumber: 'ORD-002',
      status: 'COMPLETED',
      fulfilment: 'COUNTER',
      member: null,
      customerName: 'Walk-in customer',
      items: [{ productId: 'p-2', name: 'Grip Tape', qty: 2, unitPricePaise: 5000, discountPct: 0, lineTotalPaise: 10000 }],
      totalPaise: 10000,
      channel: 'POS',
      deliveryAddress: null,
      subtotalPaise: 10000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      paymentStatus: 'PAID',
      createdAt: '2026-10-03T09:30:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    state.staff = true;
    state.update = true;
    vi.mocked(shopApi.orders).mockResolvedValue({
      data: structuredClone(sampleOrders),
      meta: { page: 1, limit: 20, totalItems: 2, totalPages: 1, hasPrevPage: false, hasNextPage: false },
    } as Awaited<ReturnType<typeof shopApi.orders>>);
    vi.mocked(shopApi.status).mockResolvedValue({} as Awaited<ReturnType<typeof shopApi.status>>);
  });

  it('shows staff status tabs and advances pickup order to ready', async () => {
    mount();
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Mark ready' })).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }));
    await waitFor(() => {
      expect(shopApi.status).toHaveBeenCalledWith('order-1', { status: 'READY' });
    });
  });

  it('filters orders by search text (order number, customer name, items)', async () => {
    mount();
    await waitFor(
      () => {
        expect(screen.getByText('ORD-001')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    const searchInput = screen.getByLabelText('Search orders');

    // Search for Tennis Racket
    fireEvent.change(searchInput, { target: { value: 'Racket' } });
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.queryByText('ORD-002')).not.toBeInTheDocument();

    // Search for POS customer
    fireEvent.change(searchInput, { target: { value: 'Walk-in' } });
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();

    // Clear search
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
  });

  it('filters orders by channel (Online vs POS)', async () => {
    mount();
    await waitFor(
      () => {
        expect(screen.getByText('ORD-001')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    // Switch to Counter sales
    fireEvent.click(screen.getByRole('button', { name: 'Counter sales' }));
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();

    // Switch to Online
    fireEvent.click(screen.getByRole('button', { name: 'Online' }));
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.queryByText('ORD-002')).not.toBeInTheDocument();
  });

  it('switches to Board view and displays kanban columns without layout breaking', async () => {
    mount();
    await waitFor(
      () => {
        expect(screen.getByText('ORD-001')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    // Click Board view switcher
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    // Board columns should be rendered
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Board' })).toBeInTheDocument();
    });
    expect(screen.getByRole('listitem', { name: 'Placed' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Ready for pickup' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Out for delivery' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Counter sales' })).toBeInTheDocument();
  });

  it('separates POS counter orders into dedicated POS column instead of oversized Done column (Issue #72)', async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByText('ORD-001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Board' })).toBeInTheDocument();
    });

    // ORD-001 is ONLINE PLACED -> in Placed column
    const placedColumn = screen.getByRole('listitem', { name: 'Placed' });
    expect(placedColumn).toHaveTextContent('ORD-001');

    // ORD-002 is POS COMPLETED -> must be in Counter sales column, NOT Done column
    const posColumn = screen.getByRole('listitem', { name: 'Counter sales' });
    expect(posColumn).toHaveTextContent('ORD-002');

    const doneColumn = screen.getByRole('listitem', { name: 'Done' });
    expect(doneColumn).not.toHaveTextContent('ORD-002');
  });

  it('uses the self endpoint and hides staff actions for members', async () => {
    state.staff = false;
    state.update = false;
    mount();
    await waitFor(
      () => {
        expect(screen.getByText('ORD-001')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(shopApi.orders).toHaveBeenCalledWith(expect.any(Object), true);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark ready' })).not.toBeInTheDocument();
  });

  it('pure filterOrders function correctly handles channel and query combinations', () => {
    const onlineOnly = filterOrders(sampleOrders, '', 'ONLINE');
    expect(onlineOnly.length).toBe(1);
    expect(onlineOnly[0].channel).toBe('ONLINE');

    const searchMatch = filterOrders(sampleOrders, '002', 'ALL');
    expect(searchMatch.length).toBe(1);
    expect(searchMatch[0].orderNumber).toBe('ORD-002');
  });
});
