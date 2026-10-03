import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shopApi } from '@/lib/shop-api';
import OrdersPage from './page';
const state = vi.hoisted(() => ({ staff: true, update: true }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'member' }, hasPermission: (permission: string) => permission === 'orders:read' ? state.staff : permission === 'orders:update' ? state.update : true }) }));
vi.mock('@/lib/shop-api', () => ({ shopApi: { orders: vi.fn(), status: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><OrdersPage /></QueryClientProvider>); }
describe('orders board', () => {
  beforeEach(() => { vi.clearAllMocks(); state.staff = true; state.update = true; vi.mocked(shopApi.orders).mockResolvedValue({ data: [{ id: 'order', orderNumber: 'ORD-1', status: 'PLACED', fulfilment: 'PICKUP', member: null, customerName: 'Walk-in', items: [], totalPaise: 50000, channel: 'ONLINE', deliveryAddress: null, subtotalPaise: 50000, discountPaise: 0, deliveryFeePaise: 0, paymentStatus: 'UNPAID', createdAt: '2026-10-03T09:00:00.000Z' }], meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1, hasPrevPage: false, hasNextPage: false } } as Awaited<ReturnType<typeof shopApi.orders>>); vi.mocked(shopApi.status).mockResolvedValue({} as Awaited<ReturnType<typeof shopApi.status>>); });
  it('shows staff status tabs and advances pickup order to ready', async () => { mount(); await waitFor(() => expect(screen.getByRole('button', { name: 'Mark ready' })).toBeInTheDocument()); fireEvent.click(screen.getByRole('button', { name: 'Mark ready' })); await waitFor(() => expect(shopApi.status).toHaveBeenCalledWith('order', { status: 'READY' })); });
  it('uses the self endpoint and hides staff actions for members', async () => { state.staff = false; state.update = false; mount(); await waitFor(() => expect(screen.getByText('ORD-1')).toBeInTheDocument()); expect(shopApi.orders).toHaveBeenCalledWith(expect.any(Object), true); expect(screen.queryByRole('tab')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Mark ready' })).not.toBeInTheDocument(); });
});
