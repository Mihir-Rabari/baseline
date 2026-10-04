import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import products from '@/mocks/shop-products.json';
import { shopApi } from '@/lib/shop-api';
import PosPage from './page';

const state = vi.hoisted(() => ({
  allowed: true,
  data: undefined as unknown,
  quote: undefined as unknown,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'staff' },
    hasPermission: () => state.allowed,
  }),
}));

vi.mock('@/hooks/use-shop', () => ({
  useShopProducts: () => ({
    data: state.data,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
  useShopQuote: () => ({
    data: state.quote,
    error: null,
    isPending: false,
    isFetching: false,
  }),
}));

vi.mock('@/lib/shop-api', () => ({
  shopApi: {
    pos: vi.fn(),
    lookup: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

/** Opens the payment dialog and returns it. */
async function openPayment() {
  fireEvent.click(screen.getByRole('button', { name: 'Take payment' }));
  return screen.findByRole('dialog', { name: 'Take payment' });
}
async function takePayment(method?: 'UPI' | 'Card' | 'Cash') {
  const dialog = await openPayment();
  if (method) fireEvent.click(within(dialog).getByRole('radio', { name: method }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Pay ₹/ }));
}

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <PosPage />
    </QueryClientProvider>
  );
}

describe('Counter sale POS (Issue #71)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.allowed = true;
    state.data = { data: products };
    state.quote = {
      items: [],
      subtotalPaise: 650000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      totalPaise: 650000,
      discountPct: 0,
    };
  });

  it('takes selected payment method and clears cart after success', async () => {
    vi.mocked(shopApi.pos).mockResolvedValue({
      orderNumber: 'ORD-000001',
    } as Awaited<ReturnType<typeof shopApi.pos>>);

    mount();

    // Add item by clicking product card
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));

    // Take payment: choose UPI in the shared payment dialog and pay
    await takePayment('UPI');

    await waitFor(() =>
      expect(shopApi.pos).toHaveBeenCalledWith({
        items: [{ productId: products[0].id, qty: 1 }],
        memberId: undefined,
        customerName: undefined,
        paymentMethod: 'UPI',
      })
    );

    await waitFor(() =>
      expect(screen.getByText('Add products to start an order.')).toBeInTheDocument()
    );
  });

  it('filters product catalogue by category tab and search input', () => {
    mount();

    // Initially all products are shown
    expect(screen.getByText('Control tennis racket')).toBeInTheDocument();
    expect(screen.getByText('Tennis balls 3-pack')).toBeInTheDocument();

    // Click 'Balls' category tab
    fireEvent.click(screen.getByRole('tab', { name: 'Balls' }));
    expect(screen.getByText('Tennis balls 3-pack')).toBeInTheDocument();
    expect(screen.queryByText('Control tennis racket')).not.toBeInTheDocument();

    // Switch back to 'All items'
    fireEvent.click(screen.getByRole('tab', { name: 'All items' }));
    expect(screen.getByText('Control tennis racket')).toBeInTheDocument();

    // Search for a specific product by SKU
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'SHOP-004' },
    });
    expect(screen.getByText('Tennis balls 3-pack')).toBeInTheDocument();
    expect(screen.queryByText('Control tennis racket')).not.toBeInTheDocument();
  });

  it('scans barcode or exact SKU on Enter and adds to cart', async () => {
    mount();

    const searchInput = screen.getByLabelText('Search products');
    fireEvent.change(searchInput, { target: { value: 'SHOP-001' } });
    fireEvent.submit(searchInput.closest('form')!);

    // Should add Control tennis racket to cart and clear search input
    expect(screen.getByLabelText('Quantity for Control tennis racket')).toHaveTextContent('1');
    expect(searchInput).toHaveValue('');
  });

  it('calculates cash change when cash tendered is entered', async () => {
    state.quote = {
      items: [{ productId: products[0].id, name: products[0].name, qty: 1, unitPricePaise: 650000, discountPct: 0, lineTotalPaise: 650000, inStock: true }],
      subtotalPaise: 650000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      totalPaise: 650000, // ₹6,500
      discountPct: 0,
    };

    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));

    // The dialog starts on Cash, which asks what was handed over
    await openPayment();
    expect(screen.getByText('Cash Tendered')).toBeInTheDocument();

    const tenderedInput = screen.getByPlaceholderText('6500.00');
    fireEvent.change(tenderedInput, { target: { value: '7000' } });

    // Change to return should be ₹500
    expect(screen.getByText('Change to return')).toBeInTheDocument();
    expect(screen.getByText(/₹\s*500/)).toBeInTheDocument();
  });

  it('retains cart and shows an out-of-stock failure', async () => {
    vi.mocked(shopApi.pos).mockRejectedValue(
      new Error('Control tennis racket has insufficient stock.')
    );
    mount();

    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));
    await takePayment('Cash');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('insufficient stock')
    );
    expect(screen.getByLabelText('Quantity for Control tennis racket')).toHaveTextContent('1');
  });

  it('allows entering walk-in customer name', async () => {
    vi.mocked(shopApi.pos).mockResolvedValue({
      orderNumber: 'ORD-000002',
    } as Awaited<ReturnType<typeof shopApi.pos>>);

    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));

    const customerInput = screen.getByLabelText('Walk-in customer name (optional)');
    fireEvent.change(customerInput, { target: { value: 'Rahul Sharma' } });

    await takePayment('Cash');

    await waitFor(() =>
      expect(shopApi.pos).toHaveBeenCalledWith({
        items: [{ productId: products[0].id, qty: 1 }],
        memberId: undefined,
        customerName: 'Rahul Sharma',
        paymentMethod: 'CASH',
      })
    );
  });

  it('calculates remaining balance when partial cash tender is entered for split payment', async () => {
    state.quote = {
      items: [
        {
          productId: products[0].id,
          name: products[0].name,
          qty: 1,
          unitPricePaise: 650000,
          discountPct: 0,
          lineTotalPaise: 650000,
          inStock: true,
        },
      ],
      subtotalPaise: 650000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      totalPaise: 650000, // ₹6,500
      discountPct: 0,
    };

    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));

    await openPayment();
    const tenderedInput = screen.getByPlaceholderText('6500.00');
    fireEvent.change(tenderedInput, { target: { value: '2000' } });

    // Remaining balance should be ₹4,500
    expect(screen.getByText('Remaining balance')).toBeInTheDocument();
    expect(screen.getByText(/₹\s*4,500/)).toBeInTheDocument();
  });

  it('displays order receipt dialog after sale and supports printing', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.mocked(shopApi.pos).mockResolvedValue({
      id: 'order-123',
      orderNumber: 'ORD-000099',
      channel: 'POS',
      fulfilment: 'COUNTER',
      status: 'COMPLETED',
      member: null,
      customerName: 'Aarav Patel',
      deliveryAddress: null,
      items: [
        {
          productId: products[0].id,
          name: products[0].name,
          qty: 1,
          unitPricePaise: 650000,
          discountPct: 0,
          lineTotalPaise: 650000,
        },
      ],
      subtotalPaise: 650000,
      discountPaise: 0,
      deliveryFeePaise: 0,
      totalPaise: 650000,
      paymentStatus: 'PAID',
      createdAt: '2026-10-04T05:00:00.000Z',
    } as Awaited<ReturnType<typeof shopApi.pos>>);

    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));
    await takePayment('Cash');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'ORD-000099' })).toBeInTheDocument()
    );
    expect(screen.getByText('Aarav Patel')).toBeInTheDocument();

    const printButton = screen.getByRole('button', { name: 'Print receipt' });
    fireEvent.click(printButton);
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('opens keyboard shortcuts modal', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'View keyboard shortcuts' }));
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Focus search / barcode input')).toBeInTheDocument();
  });

  it('hides counter controls without permission', () => {
    state.allowed = false;
    mount();
    expect(screen.getByText('Counter sales are unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take payment' })).not.toBeInTheDocument();
  });

  it('takes the full amount for every method at the counter, with no promise fee or balance left', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));
    const dialog = await openPayment();
    for (const method of ['UPI', 'Card', 'Cash'] as const) {
      fireEvent.click(within(dialog).getByRole('radio', { name: method }));
      expect(within(dialog).getByText('Pay now').nextSibling).toHaveTextContent('₹6,500');
      expect(within(dialog).queryByText('Pay later')).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/promise fee/)).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Pay ₹6,500' })).toBeInTheDocument();
    }
    expect(shopApi.pos).not.toHaveBeenCalled();
  });

  it('sells nothing when the payment dialog is cancelled, and keeps the cart', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));
    const dialog = await openPayment();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(shopApi.pos).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Quantity for Control tennis racket')).toHaveTextContent('1');
  });

  it('cannot take payment for an empty cart', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Take payment' })).toBeDisabled();
  });

  it('opens payment on the chosen method from the keyboard shortcuts', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));
    fireEvent.keyDown(window, { key: 'F9' });
    const dialog = await screen.findByRole('dialog', { name: 'Take payment' });
    expect(within(dialog).getByRole('radio', { name: 'Card' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Take payment' })).toBeInTheDocument();
    expect(shopApi.pos).not.toHaveBeenCalled();
  });

  it('does not open payment from a shortcut when the cart is empty', () => {
    mount();
    fireEvent.keyDown(window, { key: 'F8' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the payment dialog and shows the receipt after a sale', async () => {
    vi.mocked(shopApi.pos).mockResolvedValue({
      id: 'order-7', orderNumber: 'ORD-000007', channel: 'POS', fulfilment: 'COUNTER', status: 'COMPLETED', member: null, customerName: null, deliveryAddress: null,
      items: [{ productId: products[0].id, name: products[0].name, qty: 1, unitPricePaise: 650000, discountPct: 0, lineTotalPaise: 650000 }],
      subtotalPaise: 650000, discountPaise: 0, deliveryFeePaise: 0, totalPaise: 650000, paymentStatus: 'PAID', createdAt: '2026-10-04T05:00:00.000Z',
    } as Awaited<ReturnType<typeof shopApi.pos>>);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Control tennis racket/ }));
    await takePayment('Card');
    expect(await screen.findByRole('heading', { name: 'ORD-000007' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Take payment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print receipt' })).toBeInTheDocument();
    expect(shopApi.pos).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'CARD' }));
  });
});
