import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardWorkspace } from '../../../../../apps/web/src/components/club/dashboard-workspace';
const state = vi.hoisted(() => ({ permissions: [] as string[], report: vi.fn(), bookings: vi.fn(), member: vi.fn(), products: vi.fn(), leads: vi.fn(), tables: vi.fn(), tickets: vi.fn(), shift: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ hasPermission: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('@/lib/report-api', () => ({ reportApi: { dashboard: state.report } }));
vi.mock('@/lib/booking-api', () => ({ todayAtClub: () => '2026-10-03', bookingApi: { list: state.bookings, member: state.member } }));
vi.mock('@/lib/shop-api', () => ({ shopApi: { products: state.products } }));
vi.mock('@/lib/crm-api', () => ({ crmApi: { summary: state.leads } }));
vi.mock('@/lib/bar-api', () => ({ barApi: { tables: state.tables, tickets: state.tickets } }));
vi.mock('@/lib/hr-api', () => ({ hrApi: { currentShift: state.shift } }));
vi.mock('../../../../../apps/web/src/components/club/member-search', () => ({ MemberSearch: () => <p>Find member</p> }));
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardWorkspace /></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); state.permissions = []; state.report.mockResolvedValue({ to: '2026-10-03', generatedAt: '2026-10-03T12:00:00Z', kpis: { revenuePaise: 0, bookingsCount: 2, utilisationPct: 50, shopOrdersCount: 1, newMembers: 1, barTabsCount: 0, changePct: 0 }, alerts: { lowStockCount: 3, newLeadsCount: 2, pendingLeaveCount: 1, expiringMembershipsCount: 0 } }); state.bookings.mockResolvedValue({ data: [], meta: { totalItems: 2 } }); state.member.mockResolvedValue({ membership: null }); state.products.mockResolvedValue({ meta: { totalItems: 3 } }); state.leads.mockResolvedValue({ byStatus: { NEW: 2 } }); state.tables.mockResolvedValue([]); state.tickets.mockResolvedValue([]); state.shift.mockResolvedValue(null); });
describe('role workspace', () => {
  it('shows a loading skeleton while the report is pending', () => { state.permissions = ['reports:read']; state.report.mockReturnValue(new Promise(() => {})); show(); expect(screen.getByRole('status', { name: 'Loading workspace' })).toBeVisible(); });
  it('lets an owner retry a failed report without fetching staff data', async () => { state.permissions = ['reports:read']; state.report.mockRejectedValueOnce(new Error('Report unavailable')); show(); await screen.findByText('Report unavailable'); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await screen.findByText('Today at the club'); expect(state.tables).not.toHaveBeenCalled(); });
  it('gives the owner reports without fetching other role data', async () => { state.permissions = ['reports:read', 'bar:read', 'members:read', 'orders:create']; show(); await screen.findByRole('link', { name: 'View reports' }); expect(state.bookings).not.toHaveBeenCalled(); expect(state.tables).not.toHaveBeenCalled(); });
  it('shows member quick links without querying staff data', async () => { state.permissions = ['bookings:read:self']; show(); await screen.findByText('No active membership'); expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/courts'); expect(state.report).not.toHaveBeenCalled(); expect(state.leads).not.toHaveBeenCalled(); });
  it('avoids kitchen data for bar readers without the kitchen permission', async () => { state.permissions = ['bar:read']; show(); await screen.findByText('Open tabs'); expect(state.tickets).not.toHaveBeenCalled(); expect(state.member).not.toHaveBeenCalled(); });
  it('does not make domain calls for an account with no club role', () => { show(); expect(screen.queryByText('Your club workspace')).not.toBeInTheDocument(); expect(state.report).not.toHaveBeenCalled(); expect(state.bookings).not.toHaveBeenCalled(); });
  it('does not fetch product data for desk staff lacking product read permission', async () => { state.permissions = ['members:read', 'orders:create', 'inventory:read']; show(); await screen.findByText('Find member'); expect(state.products).not.toHaveBeenCalled(); expect(screen.getAllByText('Unavailable')).toHaveLength(3); });
  it('excludes cancelled tickets from the bar waiting count', async () => { state.permissions = ['bar:read', 'bar:kitchen']; state.tickets.mockResolvedValue([{ status: 'CANCELLED' }, { status: 'SERVED' }, { status: 'NEW' }]); show(); await screen.findByText('Tickets waiting'); expect(screen.getByText('1')).toBeInTheDocument(); });
});
