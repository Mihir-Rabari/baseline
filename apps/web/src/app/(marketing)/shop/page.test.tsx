import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import products from '@/mocks/shop-products.json';
import { shopApi } from '@/lib/shop-api';
import ShopPage from './page';
const state = vi.hoisted(() => ({ user: null as { id: string } | null, allowed: true, data: undefined as unknown }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: state.user, hasPermission: () => state.allowed }) }));
vi.mock('@/hooks/use-shop', () => ({ useShopProducts: () => ({ data: state.data, isPending: false, error: null }), useShopQuote: () => ({ data: { items: [], subtotalPaise: 650000, discountPaise: 97500, deliveryFeePaise: 0, totalPaise: 552500 }, isPending: false, isFetching: false, error: null }) }));
vi.mock('@/lib/shop-api', () => ({ shopApi: { online: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function mount() { const client = new QueryClient(); return render(<QueryClientProvider client={client}><ShopPage /></QueryClientProvider>); }
describe('shop browser', () => {
  beforeEach(() => { state.user = null; state.allowed = true; state.data = { data: products }; vi.clearAllMocks(); });
  it('browses categories and allows cart editing while asking guests to sign in', () => {
    mount(); expect(screen.getByRole('link', { name: 'Sign in to order' })).toHaveAttribute('href', '/login');
    expect(screen.getByText('Sold out')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Add Badminton shuttle tube' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add Control tennis racket' })); expect(screen.getByLabelText('Quantity for Control tennis racket')).toHaveTextContent('1');
  });
  const submitInDialog = () => fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!);
  it('checks out by UPI by default: the order is placed with payNow and the cart clears', async () => {
    state.user = { id: 'member' }; vi.mocked(shopApi.online).mockResolvedValue({ orderNumber: 'ORD-000001', paymentStatus: 'PAID' } as Awaited<ReturnType<typeof shopApi.online>>);
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Add Control tennis racket' })); fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(screen.getByRole('radio', { name: 'UPI' })).toBeChecked(); submitInDialog();
    await waitFor(() => expect(shopApi.online).toHaveBeenCalledWith({ items: [{ productId: products[0].id, qty: 1 }], fulfilment: 'PICKUP', deliveryAddress: undefined, payNow: { method: 'UPI' } }));
    await waitFor(() => expect(screen.getByText('Add products to start an order.')).toBeInTheDocument());
  });
  it('card pays now; cash places the order without payNow to pay at pickup', async () => {
    state.user = { id: 'member' }; vi.mocked(shopApi.online).mockResolvedValue({ orderNumber: 'ORD-000002', paymentStatus: 'UNPAID' } as Awaited<ReturnType<typeof shopApi.online>>);
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Add Control tennis racket' })); fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    fireEvent.click(screen.getByLabelText('Cash')); expect(screen.getByText(/Pay in cash when you collect/)).toBeInTheDocument(); submitInDialog();
    await waitFor(() => expect(shopApi.online).toHaveBeenCalledWith({ items: [{ productId: products[0].id, qty: 1 }], fulfilment: 'PICKUP', deliveryAddress: undefined }));
  });
  it('keeps the dialog open with the reason when the order fails, and charges nothing', async () => {
    state.user = { id: 'member' }; vi.mocked(shopApi.online).mockRejectedValue(new Error('Control tennis racket is out of stock'));
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Add Control tennis racket' })); fireEvent.click(screen.getByRole('button', { name: 'Checkout' })); submitInDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('out of stock');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('does not expose checkout to accounts without online ordering permission', () => { state.user = { id: 'staff' }; state.allowed = false; mount(); expect(screen.queryByRole('button', { name: 'Checkout' })).not.toBeInTheDocument(); expect(screen.getByText('A member account is required to order online.')).toBeInTheDocument(); });
});
