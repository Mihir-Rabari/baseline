import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import products from '@/mocks/shop-products.json';
import { shopApi } from '@/lib/shop-api';
import PosPage from './page';
const state = vi.hoisted(() => ({ allowed: true, data: undefined as unknown, quote: undefined as unknown }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'staff' }, hasPermission: () => state.allowed }) }));
vi.mock('@/hooks/use-shop', () => ({ useShopProducts: () => ({ data: state.data, error: null, isPending: false }), useShopQuote: () => ({ data: state.quote, error: null, isPending: false, isFetching: false }) }));
vi.mock('@/lib/shop-api', () => ({ shopApi: { pos: vi.fn(), lookup: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function mount() { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); return render(<QueryClientProvider client={client}><PosPage /></QueryClientProvider>); }
describe('counter sale', () => {
  beforeEach(() => { vi.clearAllMocks(); state.allowed = true; state.data = { data: products }; state.quote = { items: [], subtotalPaise: 650000, discountPaise: 0, deliveryFeePaise: 0, totalPaise: 650000, discountPct: 0 }; });
  it('takes selected payment method and clears cart after success', async () => {
    vi.mocked(shopApi.pos).mockResolvedValue({ orderNumber: 'ORD-000001' } as Awaited<ReturnType<typeof shopApi.pos>>);
    mount(); fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ })); fireEvent.click(screen.getByRole('button', { name: 'Pay UPI' }));
    await waitFor(() => expect(shopApi.pos).toHaveBeenCalledWith({ items: [{ productId: products[0].id, qty: 1 }], memberId: undefined, paymentMethod: 'UPI' }));
    await waitFor(() => expect(screen.getByText('Add products to start an order.')).toBeInTheDocument());
  });
  it('retains cart and shows an out-of-stock failure', async () => {
    vi.mocked(shopApi.pos).mockRejectedValue(new Error('Control tennis racket has insufficient stock.'));
    mount(); fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ })); fireEvent.click(screen.getByRole('button', { name: 'Pay cash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('insufficient stock')); expect(screen.getByLabelText('Quantity for Control tennis racket')).toHaveTextContent('1');
  });
  it('hides counter controls without permission', () => { state.allowed = false; mount(); expect(screen.getByText('Counter sales are unavailable')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Pay cash' })).not.toBeInTheDocument(); });
});
