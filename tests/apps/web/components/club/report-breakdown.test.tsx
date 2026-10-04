import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { mockBreakdown, periodQuery, reportApi } from '@/lib/report-api';
import { BreakdownSections, ReportBreakdownPanel } from '../../../../../apps/web/src/components/club/report-breakdown';

describe('report breakdown', () => {
  it('shows every area with its figures', () => {
    render(<BreakdownSections r={mockBreakdown('today')} />);
    for (const name of ['Court bookings', 'Shop and counter sales', 'Bar', 'Inventory', 'Members', 'Payroll']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('region', { name: 'Inventory' })).getByText('Grip tape (GRP-01)')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Payroll' })).getByText('Front desk')).toBeInTheDocument();
  });

  it('ties payroll runs and approved leave into the payroll area', () => {
    render(<BreakdownSections r={mockBreakdown('today')} />);
    const payroll = within(screen.getByRole('region', { name: 'Payroll' }));
    expect(payroll.getByText('2030-03 (Paid)')).toBeInTheDocument();
    expect(payroll.getByText('5 approved leave days in this period')).toBeInTheDocument();
  });

  it('says so when an area has nothing to show', () => {
    const empty = { ...mockBreakdown('today'), bookings: { total: 0, cancelled: 0, bookedValuePaise: 0, bySport: [], byChannel: [], byCourt: [] }, inventory: { stockValuePaise: 0, unitsSold: 0, lowStock: [] } };
    render(<BreakdownSections r={empty} />);
    expect(screen.getByText('No bookings in this period.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is running low.')).toBeInTheDocument();
  });

  it('loads for the chosen period, and shows an error with retry', async () => {
    const spy = vi.spyOn(reportApi, 'breakdown').mockRejectedValueOnce(new Error('Breakdown unavailable')).mockResolvedValue(mockBreakdown({ from: '2030-03-01', to: '2030-03-10' }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReportBreakdownPanel period={{ from: '2030-03-01', to: '2030-03-10' }} /></QueryClientProvider>);
    expect(await screen.findByText('Breakdown unavailable')).toBeInTheDocument();
    screen.getByRole('button', { name: /try again|retry/i }).click();
    expect(await screen.findByRole('region', { name: 'Court bookings' })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ from: '2030-03-01', to: '2030-03-10' });
  });

  it('builds the query for presets and custom windows', () => {
    expect(periodQuery('week')).toBe('range=week');
    expect(periodQuery({ from: '2030-03-01', to: '2030-03-10' })).toBe('from=2030-03-01&to=2030-03-10');
    expect(reportApi.exportUrl({ from: '2030-03-01', to: '2030-03-10' }, 'breakdown')).toContain('from=2030-03-01&to=2030-03-10&type=breakdown');
  });
});
