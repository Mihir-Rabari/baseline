import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from './orders/page';
import InventoryPage from './inventory/page';
import CrmPage from './crm/page';
import KitchenPage from './bar/kitchen/page';
import EarningsPage from './bar/earnings/page';
import ShiftsPage from './shifts/page';
import InvoicesPage from './invoices/page';
import HrPage from './hr/page';
import ReportsPage from './reports/page';
import ClubSettingsPage from './admin/club/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  data: {} as Record<string, unknown>,
  error: null as Error | null,
  pending: false,
  paths: [] as string[],
  mutate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' }, isRoot: false, hasPermission: (p: string) => state.permissions.has(p) }) }));
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: unknown) => value }));
vi.mock('@/hooks/use-plans', () => ({ usePlans: () => ({ data: [{ id: 'p1', name: 'Silver' }] }) }));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: (_key: unknown, path: string, options?: { enabled?: boolean }) => {
    state.paths.push(path);
    const base = path.split('?')[0];
    const enabled = options?.enabled ?? true;
    return { data: enabled ? state.data[base] : undefined, error: enabled ? state.error : null, isPending: enabled ? state.pending : false, refetch: state.refetch };
  },
  useOpsMutation: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock('@/components/club/member-search', () => ({ MemberSearch: () => <div>member search</div> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const meta = { page: 1, limit: 20, totalItems: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false };
const page = (data: unknown[]) => ({ data, meta });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { permissions: new Set<string>(), data: {}, error: null, pending: false, paths: [] });
  state.mutate.mockResolvedValue({});
});

describe('operations screens: access, states and data', () => {
  it.each([
    ['orders', OrdersPage], ['inventory', InventoryPage], ['leads', CrmPage], ['the kitchen screen', KitchenPage], ['bar earnings', EarningsPage],
    ['shifts', ShiftsPage], ['invoices', InvoicesPage], ['staff and leave', HrPage], ['reports', ReportsPage], ['club settings', ClubSettingsPage],
  ] as const)('shows a clear no-access message and fetches nothing for %s without permission', (what, Page) => {
    render(<Page />);
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(what))).toBeInTheDocument();
  });

  it('orders: staff see online orders and can advance a placed pickup order', async () => {
    state.permissions = new Set(['orders:read', 'orders:update']);
    state.data['/orders'] = page([{ id: 'o1', orderNumber: 'ORD-000010', channel: 'ONLINE', fulfilment: 'PICKUP', status: 'PLACED', member: { fullName: 'Aarav Mehta' }, customerName: null, deliveryAddress: null, items: [{ name: 'Club Cap', qty: 2 }], totalPaise: 59800, paymentStatus: 'PAID', createdAt: '2026-10-03T10:00:00.000Z' }]);
    render(<OrdersPage />);
    expect(screen.getByText('ORD-000010')).toBeInTheDocument();
    expect(screen.getByText('2× Club Cap')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ id: 'o1', status: 'READY' }));
  });

  it('orders: a member without staff access reads their own orders endpoint', () => {
    state.permissions = new Set(['orders:read:self']);
    state.data['/me/orders'] = page([]);
    render(<OrdersPage />);
    expect(screen.getByRole('heading', { name: 'My orders' })).toBeInTheDocument();
    expect(state.paths.some((p) => p.startsWith('/me/orders'))).toBe(true);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('error state offers a retry', () => {
    state.permissions = new Set(['orders:read']);
    state.error = new Error('Service unavailable');
    render(<OrdersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it('inventory: flags low and sold-out stock and validates a restock', async () => {
    state.permissions = new Set(['inventory:read']);
    state.data['/products'] = page([
      { id: 'a', sku: 'A', name: 'Low Racket', category: 'RACKET', pricePaise: 100000, stockQty: 2, lowStock: true },
      { id: 'b', sku: 'B', name: 'Gone Ball', category: 'BALL', pricePaise: 5000, stockQty: 0, lowStock: true },
    ]);
    render(<InventoryPage />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update stock for Low Racket' }));
    fireEvent.change(screen.getByLabelText('Units received'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number above zero.')).toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Units received'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ id: 'a', qty: 10, note: undefined }));
  });

  it('crm: shows the funnel summary and hides actions from users who cannot manage', () => {
    state.permissions = new Set(['crm:read']);
    state.data['/crm/summary'] = { byStatus: { NEW: 3, CONTACTED: 1, QUOTED: 0, WON: 1, LOST: 1 }, dueToday: 2, overdue: 1, conversionRatePct: 16.666666 };
    state.data['/crm/leads'] = page([{ id: 'l1', name: 'Meera Joshi', phone: '9833344455', email: null, source: 'WALK_IN', status: 'NEW', interestedPlan: { name: 'Silver' }, message: null, createdAt: '2026-10-03T10:00:00.000Z', quoteCount: 0 }]);
    render(<CrmPage />);
    expect(screen.getByText('Meera Joshi')).toBeInTheDocument();
    expect(screen.getByText('16.7%')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument();
  });

  it('crm: managers can convert a lead, which asks for the plan and payment', async () => {
    state.permissions = new Set(['crm:read', 'crm:manage']);
    state.data['/crm/summary'] = { byStatus: { NEW: 1, CONTACTED: 0, QUOTED: 0, WON: 0, LOST: 0 }, dueToday: 0, overdue: 0, conversionRatePct: 0 };
    state.data['/crm/leads'] = page([{ id: 'l1', name: 'Meera Joshi', phone: '9833344455', email: null, source: 'WALK_IN', status: 'NEW', interestedPlan: { id: 'p1', name: 'Silver' }, message: null, createdAt: '2026-10-03T10:00:00.000Z', quoteCount: 0 }]);
    render(<CrmPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(await screen.findByText('Convert Meera Joshi to a member')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan')).toBeInTheDocument();
    expect(screen.getByLabelText('Paid by')).toBeInTheDocument();
  });

  it('kitchen: lists tickets oldest first with the right next action', async () => {
    state.permissions = new Set(['bar:kitchen']);
    state.data['/bar/tickets'] = [
      { id: 't1', ticketNumber: 1, tab: { label: 'Table 3' }, table: null, station: 'BAR', status: 'NEW', minutesWaiting: 12, items: [{ name: 'Masala Chai', qty: 4, note: null }] },
      { id: 't2', ticketNumber: 2, tab: { label: 'Table 5' }, table: { name: 'T5' }, station: 'KITCHEN', status: 'READY', minutesWaiting: 3, items: [{ name: 'Fries', qty: 1, note: 'no salt' }] },
    ];
    render(<KitchenPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start preparing' }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ id: 't1', status: 'PREPARING' }));
    expect(screen.getByRole('button', { name: 'Mark served' })).toBeInTheDocument();
    expect(screen.getByText(/no salt/)).toBeInTheDocument();
  });

  it('bar earnings: totals, methods and an honest empty shift list', () => {
    state.permissions = new Set(['bar:read']);
    state.data['/bar/earnings'] = { date: '2026-10-03', totalPaise: 57000, tabsSettled: 1, averageTabPaise: 57000, byMethod: [{ method: 'UPI', amountPaise: 57000 }], byShift: [], topItems: [{ name: 'Masala Chai', qty: 4, amountPaise: 24000 }] };
    render(<EarningsPage />);
    expect(screen.getAllByText('₹570').length).toBeGreaterThan(0);
    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByText(/No payments were taken during a clocked-in shift/)).toBeInTheDocument();
  });

  it('shifts: shows the roster and lets a clocked-in employee clock out', async () => {
    state.permissions = new Set(['shifts:read', 'shifts:clock:self']);
    const shift = { id: 's1', employee: { id: 'e1', fullName: 'Demo Bar Staff' }, roleLabel: 'BAR', startsAt: '2026-10-03T10:30:00.000Z', endsAt: '2026-10-03T18:30:00.000Z', clockInAt: '2026-10-03T10:34:00.000Z', clockOutAt: null, status: 'ON_SHIFT' };
    state.data['/shifts'] = [shift];
    state.data['/me/shift/current'] = shift;
    render(<ShiftsPage />);
    expect(screen.getAllByText('Demo Bar Staff').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Schedule shift' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clock out' }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ id: 's1' }));
  });

  it('invoices: lists invoices; only staff who can create see the New invoice button', () => {
    state.permissions = new Set(['invoices:read']);
    state.data['/invoices'] = page([{ id: 'i1', invoiceNumber: 'INV-2026-0001', status: 'SENT', billTo: { type: 'MEMBER', id: 'm', name: 'Demo Member' }, issueDate: '2026-10-03', dueDate: '2026-10-13', lines: [], subtotalPaise: 570000, taxPaise: 86949, totalPaise: 570000, paidPaise: 0, balancePaise: 570000, notes: null }]);
    render(<InvoicesPage />);
    expect(screen.getByRole('button', { name: 'INV-2026-0001' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
  });

  it('hr: tabs depend on permissions; a bar employee gets only their own leave', () => {
    state.permissions = new Set(['leave:read:self']);
    state.data['/me/leave'] = page([]);
    render(<HrPage />);
    expect(screen.getByRole('tab', { name: 'My leave' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Employees' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Payroll' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request leave' })).toBeInTheDocument();
  });

  it('hr: the owner sees employees and pending leave decisions', async () => {
    state.permissions = new Set(['hr:read', 'leave:read', 'leave:decide']);
    state.data['/hr/employees'] = [{ id: 'e1', fullName: 'Demo Bar Staff', position: 'Bartender', department: 'BAR', monthlySalaryPaise: 2400000, hiredOn: '2025-08-29', status: 'ACTIVE', leaveDaysThisYear: 2 }];
    render(<HrPage />);
    expect(screen.getByText('Demo Bar Staff')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payroll' })).toBeInTheDocument();
  });

  it('reports: revenue, sources, what we owe and the share control', () => {
    state.permissions = new Set(['reports:read', 'reports:share']);
    state.data['/reports/dashboard'] = {
      range: 'month', from: '2026-10-01', to: '2026-10-31', generatedAt: '2026-10-03T10:00:00.000Z',
      kpis: { revenuePaise: 7194900, previousRevenuePaise: 0, changePct: -57, bookingsCount: 10, utilisationPct: 4, newMembers: 41, shopOrdersCount: 6, barTabsCount: 1 },
      bySource: [{ source: 'COURT', amountPaise: 1059000 }], byMethod: [{ method: 'UPI', amountPaise: 3567800 }],
      trend: [{ bucket: '2026-10-03', totalPaise: 5015500, bySource: {} }],
      owed: { taxPayablePaise: 1055410, payrollDuePaise: 26500000, unpaidInvoicesPaise: 1370000, overdueInvoicesCount: 1 },
      alerts: { lowStockCount: 3, expiringMembershipsCount: 3, newLeadsCount: 3, pendingLeaveCount: 1 },
    };
    render(<ReportsPage />);
    expect(screen.getByText('₹71,949')).toBeInTheDocument();
    expect(screen.getByText('-57% vs previous period')).toBeInTheDocument();
    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toContain('/reports/export.csv?range=month');
  });

  it('club settings: owner edits social windows, others see them read only', () => {
    state.permissions = new Set(['admin:access']);
    state.data['/public/club'] = { name: 'CourtOS', hours: { open: '06:00', close: '22:00' }, timezone: 'Asia/Kolkata', phone: '', courtTypes: [] };
    state.data['/social-windows'] = [{ id: 'w1', weekday: 5, startsTime: '18:00', endsTime: '22:00', isActive: true }];
    const { unmount } = render(<ClubSettingsPage />);
    expect(screen.getByText(/Only the owner can change them./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    unmount();
    state.permissions = new Set(['admin:access', 'courts:update']);
    render(<ClubSettingsPage />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });
});
