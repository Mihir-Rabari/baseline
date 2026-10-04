import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { Cart } from '../../../../../apps/web/src/components/club/cart';
import { MemberSearch } from '../../../../../apps/web/src/components/club/member-search';
import { useShopCart } from '@/hooks/use-shop-cart';
import { api } from '@/lib/api-client';
import products from '@/mocks/shop-products.json';
import { PublicProductSchema } from '@packages/validation';
vi.mock('@/lib/api-client', () => ({ api: { members: { lookup: vi.fn() } } }));
function CartHarness() { const cart = useShopCart(); return <><button onClick={() => cart.add(PublicProductSchema.parse(products[0]))}>Add racket</button><Cart lines={cart.lines} onQuantity={cart.quantity} /></>; }
describe('shop components', () => {
  it('adds, adjusts and removes cart items', () => {
    render(<CartHarness />); expect(screen.getByText('Add products to start an order.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add racket' })); fireEvent.click(screen.getByRole('button', { name: `Increase ${products[0].name}` }));
    expect(screen.getByLabelText(`Quantity for ${products[0].name}`)).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: `Decrease ${products[0].name}` })); expect(screen.getByLabelText(`Quantity for ${products[0].name}`)).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: `Remove ${products[0].name}` })); expect(screen.getByText('Add products to start an order.')).toBeInTheDocument();
  });
  it('debounces lookup and selects a keyboard-accessible member result', async () => {
    const m = { id: 'member', fullName: 'Aarav Mehta', memberCode: 'CC-000001', phone: '9876543201', planCode: 'GOLD', expiryState: 'OK' as const, shopDiscountPct: 15, barDiscountPct: 10 };
    vi.mocked(api.members.lookup).mockResolvedValue([m]); const onChange = vi.fn(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemberSearch value={null} onChange={onChange} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('Member'), { target: { value: 'Aa' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Aarav Mehta/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Aarav Mehta/ })); expect(onChange).toHaveBeenCalledWith(m); client.clear();
  });
  it('shows selected discounts and clears a member', () => {
    const onChange = vi.fn(); const client = new QueryClient(); render(<QueryClientProvider client={client}><MemberSearch value={{ id: 'member', fullName: 'Aarav Mehta', memberCode: 'CC-1', phone: '9876543201', planCode: 'GOLD', expiryState: 'OK', shopDiscountPct: 15, barDiscountPct: 10 }} onChange={onChange} /></QueryClientProvider>);
    expect(screen.getByText(/shop 15%/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Change member' })); expect(onChange).toHaveBeenCalledWith(null); client.clear();
  });
  it('freezes cart changes during payment', () => {
    render(<Cart lines={[{product:PublicProductSchema.parse(products[0]),qty:1}]} onQuantity={vi.fn()} disabled />);
    expect(screen.getByRole('button',{name:'Increase Control tennis racket'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Decrease Control tennis racket'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Remove Control tennis racket'})).toBeDisabled();
  });
  it('marks the failing stock line from API error details',()=>{
    const error=Object.assign(new Error('Not enough stock'),{details:[{field:'items[0].productId',message:'requested 2, available 1',code:'OUT_OF_STOCK'}]});
    render(<Cart lines={[{product:PublicProductSchema.parse(products[0]),qty:2}]} onQuantity={vi.fn()} error={error}/>);
    expect(screen.getByText('Control tennis racket')).toHaveClass('text-destructive');expect(screen.getByRole('alert')).toHaveTextContent('Not enough stock');
  });
});
