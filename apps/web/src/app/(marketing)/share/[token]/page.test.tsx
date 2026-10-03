import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SharedDashboardReportSchema } from '@packages/validation';
import { mockDashboard } from '@/lib/report-api';
import SharedReportPage from './page';
const state = vi.hoisted(() => ({ shared: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ token: 'token' }) }));
vi.mock('@/lib/report-api', async original => { const actual = await original<typeof import('@/lib/report-api')>(); return { ...actual, reportApi: { shared: state.shared } }; });
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SharedReportPage /></QueryClientProvider>); }
beforeEach(() => { state.shared.mockReset(); });
describe('public share view', () => {
  it('shows expiry and summary charts without private obligations or alerts', async () => { state.shared.mockResolvedValue({ ...SharedDashboardReportSchema.parse(mockDashboard('today')), expiresAt: '2026-10-10T00:00:00Z' }); show(); await screen.findByText('Revenue by source'); expect(screen.getByText(/Expires/)).toBeInTheDocument(); expect(screen.queryByText('What we owe')).not.toBeInTheDocument(); expect(screen.queryByText('Needs attention')).not.toBeInTheDocument(); });
  it('shows the expired or revoked state on 404', async () => { state.shared.mockRejectedValue(Object.assign(new Error('Expired'), { statusCode: 404 })); show(); await screen.findByText('This link has expired or was revoked'); expect(screen.queryByText('Revenue by source')).not.toBeInTheDocument(); });
});
