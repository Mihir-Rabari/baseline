import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockDashboard } from '@/lib/report-api';
import ReportsPage from './page';
const state = vi.hoisted(() => ({ allowed: true, canShare: true, dashboard: vi.fn(), share: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'owner' }, hasPermission: (permission: string) => permission === 'reports:share' ? state.canShare : state.allowed }) }));
vi.mock('@/lib/report-api', async original => { const actual = await original<typeof import('@/lib/report-api')>(); return { ...actual, reportApi: { dashboard: state.dashboard, share: state.share, exportUrl: (range: string) => `/exports?range=${range}` } }; });
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ReportsPage /></QueryClientProvider>); }
beforeEach(() => { state.allowed = true; state.canShare = true; state.dashboard.mockReset().mockImplementation(range => Promise.resolve(mockDashboard(range))); state.share.mockReset(); });
describe('owner reports', () => {
  it('denies access and does not query without the report permission', () => { state.allowed = false; show(); expect(screen.getByText('Reports are unavailable')).toBeInTheDocument(); expect(state.dashboard).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument(); });
  it('allows report readers to export without granting share actions', async () => { state.canShare = false; show(); await screen.findByText('Revenue by source'); expect(screen.getByRole('link', { name: 'Export CSV' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument(); expect(state.share).not.toHaveBeenCalled(); });
  it('renders figures, readable charts and changes range', async () => { show(); await screen.findByText('Revenue by source'); expect(screen.getByRole('img', { name: 'Revenue trend over the selected period' })).toBeInTheDocument(); fireEvent.mouseDown(screen.getByRole('tab', { name: 'This month' }), { button: 0, ctrlKey: false }); await waitFor(() => expect(state.dashboard).toHaveBeenCalledWith('month')); expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/exports?range=month'); });
  it('reports errors and offers retry', async () => { state.dashboard.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(mockDashboard('today')); show(); await screen.findByText('Unavailable'); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await screen.findByText('Revenue by source'); });
  it('shows an empty revenue period and share failure', async () => { const report = mockDashboard('today'); report.kpis.revenuePaise = 0; state.dashboard.mockResolvedValue(report); state.share.mockRejectedValue(new Error('Sharing unavailable')); show(); await screen.findByText('No revenue this period'); fireEvent.click(screen.getByRole('button', { name: 'Share' })); fireEvent.click(screen.getByRole('button', { name: 'Create share link' })); await screen.findByText('Sharing unavailable'); });
});
