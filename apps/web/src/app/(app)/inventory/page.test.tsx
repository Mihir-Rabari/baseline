import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import products from '@/mocks/shop-products.json';
import InventoryPage from './page';
const state = vi.hoisted(() => ({ allowed: true, adjust: true, low: false, mutate: vi.fn(), reset: vi.fn(), error: null as Error | null }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'staff' }, hasPermission: (permission: string) => permission === 'inventory:adjust' ? state.adjust : state.allowed }) }));
vi.mock('@/hooks/use-shop', () => ({ useShopProducts: (params: { lowStock?: string }) => ({ data: { data: params.lowStock === 'true' ? products.filter((p) => p.lowStock) : products }, isPending: false, error: state.error, refetch: vi.fn() }), useRestock: () => ({ mutateAsync: state.mutate, reset: state.reset, error: null, isPending: false }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
describe('inventory', () => {
  beforeEach(() => { state.allowed = true; state.adjust = true; state.error = null; state.mutate.mockReset().mockResolvedValue({}); });
  it('filters low stock and sends validated restock quantities', async () => {
    render(<InventoryPage />); expect(screen.getAllByRole('row')).toHaveLength(13);
    fireEvent.click(screen.getByRole('switch', { name: 'Low stock only' })); expect(screen.getAllByRole('row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Restock Tennis balls 3-pack' }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Received today' } }); fireEvent.click(screen.getByRole('button', { name: 'Save restock' }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ id: products[3].id, data: { qty: 5, note: 'Received today' } })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('prevents restock without adjustment permission and hides inventory without read permission', () => {
    state.adjust = false; const { rerender } = render(<InventoryPage />); expect(screen.queryByRole('button', { name: /Restock/ })).not.toBeInTheDocument();
    state.allowed = false; rerender(<InventoryPage />); expect(screen.getByText('Inventory is unavailable')).toBeInTheDocument();
  });
});
