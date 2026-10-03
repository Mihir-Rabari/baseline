import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DashboardReport } from '@packages/validation';
import { OwnerDashboard } from './owner-dashboard';
const state = vi.hoisted(() => ({ permissions: [] as string[], bookings: vi.fn(), orders: vi.fn(), shifts: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ hasPermission: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('@/lib/booking-api', () => ({ todayAtClub: () => '2026-10-04', bookingApi: { list: state.bookings } }));
vi.mock('@/lib/shop-api', () => ({ shopApi: { orders: state.orders } }));
vi.mock('@/lib/hr-api', () => ({ hrApi: { shifts: state.shifts } }));
vi.mock('./club-site-link', () => ({ ClubSiteLink: () => <p>Club website</p> }));
const report: DashboardReport = {
  range: 'today', from: '2026-10-04', to: '2026-10-04', generatedAt: '2026-10-04T12:00:00Z',
  kpis: { revenuePaise: 123400, previousRevenuePaise: 100000, changePct: 23.4, bookingsCount: 12, utilisationPct: 68, newMembers: 2, shopOrdersCount: 8, barTabsCount: 6 },
  trend: [{ bucket: '2026-10-04', totalPaise: 123400, bySource: { COURT: 123400, MEMBERSHIP: 0, SHOP: 0, BAR: 0, INVOICE: 0 } }],
  bySource: [{ source: 'COURT', amountPaise: 123400 }], byMethod: [{ method: 'UPI', amountPaise: 123400 }],
  owed: { taxPayablePaise: 0, payrollDuePaise: 0, unpaidInvoicesPaise: 0, overdueInvoicesCount: 0 },
  alerts: { lowStockCount: 3, expiringMembershipsCount: 4, newLeadsCount: 6, pendingLeaveCount: 2 },
};
function show(data = report) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OwnerDashboard report={data} /></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); state.permissions = [];
  state.bookings.mockResolvedValue({ data: [], meta: { hasNextPage: false } });
  state.orders.mockImplementation(async (query: { status?: string }) => ({ data: [], meta: { totalItems: query.status === 'PLACED' ? 4 : query.status === 'READY' ? 2 : 0 } }));
  state.shifts.mockResolvedValue([{ status: 'ON_SHIFT' }, { status: 'DONE' }, { status: 'SCHEDULED' }]);
});
describe('Owner dashboard', () => {
  it('renders report KPIs and charts without requesting inaccessible domains', () => {
    show(); expect(screen.getByText('Revenue today').parentElement).toHaveTextContent('₹1,234');
    expect(screen.getByText('Bookings today').parentElement).toHaveTextContent('12'); expect(screen.getByText('Court occupancy').parentElement).toHaveTextContent('68%');
    expect(screen.getByRole('img', { name: 'Revenue trend over the selected period' })).toBeVisible();
    expect(state.bookings).not.toHaveBeenCalled(); expect(state.orders).not.toHaveBeenCalled(); expect(state.shifts).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Quick actions' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /products low/ })).not.toBeInTheDocument();
  });
  it('requires both destination permissions for compound quick actions', () => {
    state.permissions = ['bookings:create', 'members:create', 'orders:create', 'invoices:create']; show();
    expect(screen.getByRole('link', { name: 'Create invoice' })).toHaveAttribute('href', '/invoices/new');
    for (const name of ['New booking', 'Add member', 'Counter sale']) expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
  });
  it('links all permitted quick actions to working routes', async () => {
    state.permissions = ['bookings:create', 'bookings:read', 'members:create', 'memberships:create', 'orders:create', 'products:read', 'invoices:create']; show();
    expect(screen.getByRole('link', { name: 'New booking' })).toHaveAttribute('href', '/courts'); expect(screen.getByRole('link', { name: 'Add member' })).toHaveAttribute('href', '/members/new'); expect(screen.getByRole('link', { name: 'Counter sale' })).toHaveAttribute('href', '/pos'); await screen.findByText('No upcoming bookings in this preview.');
  });
  it('renders a shaped staff loading state outside the numeric paragraph', () => { state.permissions = ['shifts:read', 'shifts:read:all']; state.shifts.mockReturnValue(new Promise(() => {})); show(); expect(screen.getByRole('status', { name: 'Loading staff count' })).toBeVisible(); expect(screen.queryByText('Unavailable')).not.toBeInTheDocument(); });
  it('uses full pending-order metadata and only counts clocked-in staff', async () => {
    state.permissions = ['orders:read', 'shifts:read', 'shifts:read:all']; show();
    expect(await screen.findByRole('link', { name: '6 orders awaiting fulfilment' })).toHaveAttribute('href', '/orders');
    expect(await within(screen.getByText('Staff on shift').parentElement!).findByText('1')).toBeVisible();
    for (const status of ['PLACED', 'READY', 'OUT_FOR_DELIVERY']) expect(state.orders).toHaveBeenCalledWith({ status, limit: 1 });
  });
  it('does not treat a self-only or capped roster as a club total', async () => {
    state.permissions = ['shifts:read']; const view = show(); expect(state.shifts).not.toHaveBeenCalled(); view.unmount();
    state.permissions.push('shifts:read:all'); state.shifts.mockResolvedValue(Array.from({ length: 500 }, () => ({ status: 'ON_SHIFT' }))); show(); expect(await screen.findByText('Unavailable')).toBeVisible();
  });
  it('filters past and cancelled bookings, sorts the preview and discloses further pages', async () => {
    state.permissions = ['bookings:read'];
    const booking = (id: string, startsAt: string, status = 'CONFIRMED') => ({ id, startsAt, status, court: { name: id }, member: { fullName: 'Khushi' } });
    state.bookings.mockResolvedValue({ data: [booking('Later', '2099-10-04T14:00:00Z'), booking('Cancelled', '2099-10-04T12:00:00Z', 'CANCELLED'), booking('Past', '2000-10-04T12:00:00Z'), booking('Earlier', '2099-10-04T12:00:00Z')], meta: { hasNextPage: true } });
    show(); await screen.findByText('Earlier'); const section = screen.getByRole('region', { name: 'Upcoming bookings today' }); const rows = within(section).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Earlier'); expect(rows[1]).toHaveTextContent('Later'); expect(within(section).queryByText('Cancelled')).not.toBeInTheDocument(); expect(within(section).queryByText('Past')).not.toBeInTheDocument(); expect(within(section).getByText('More bookings are available in the full schedule.')).toBeVisible();
  });
  it('retains report content when an optional request fails and lets it retry', async () => {
    state.permissions = ['bookings:read']; state.bookings.mockRejectedValueOnce(new Error('Bookings temporarily unavailable')); show(); await screen.findByText('Bookings temporarily unavailable'); expect(screen.getByText('Revenue today')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(await screen.findByText('No upcoming bookings in this preview.')).toBeVisible();
  });
  it('shows order amounts and fulfilment status in recent activity', async () => {
    state.permissions = ['orders:read']; state.orders.mockImplementation(async (query: { status?: string }) => ({ data: query.status ? [] : [{ id: 'order-1', orderNumber: 'ORD-000123', totalPaise: 25000, status: 'OUT_FOR_DELIVERY', createdAt: '2026-10-04T12:00:00Z' }], meta: { totalItems: 0 } })); show();
    const section = screen.getByRole('region', { name: 'Recent order activity' }); expect(await within(section).findByText('ORD-000123 · ₹250')).toBeVisible(); expect(within(section).getByText(/out for delivery/)).toBeVisible();
  });
  it('does not claim all-clear while order alerts load or fail', async () => {
    state.permissions = ['orders:read']; state.orders.mockRejectedValue(new Error('Orders unavailable')); show({ ...report, alerts: { lowStockCount: 0, expiringMembershipsCount: 0, newLeadsCount: 0, pendingLeaveCount: 0 } });
    expect(screen.getByLabelText('Loading order alerts')).toBeVisible(); expect(screen.queryByText('No alerts in the areas you can access.')).not.toBeInTheDocument(); await screen.findAllByText('Orders unavailable'); expect(screen.queryByText('No alerts in the areas you can access.')).not.toBeInTheDocument();
  });
  it('uses explicit empty states for revenue and orders', async () => {
    state.permissions = ['orders:read']; show({ ...report, kpis: { ...report.kpis, revenuePaise: 0 } }); expect(screen.getByText('No revenue today')).toBeVisible(); expect(await screen.findByText('No orders yet')).toBeVisible(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
