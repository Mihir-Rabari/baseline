import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportCharts, RevenueBars } from '../../../../../apps/web/src/components/club/charts';
import { mockDashboard } from '@/lib/report-api';
describe('readable report charts', () => {
  it('shows a visible point and a labelled value for a single-day report', () => { const { container } = render(<ReportCharts report={mockDashboard('today')} />); expect(container.querySelectorAll('svg circle')).toHaveLength(1); expect(screen.getByText('View daily revenue')).toBeInTheDocument(); expect(container.querySelector('circle title')?.textContent).toContain(mockDashboard('today').to); });
  it('labels net refunds and retains a visible bar instead of silently clipping them', () => { const { container } = render(<RevenueBars title="Revenue" rows={[{ label: 'court', amountPaise: -42000 }]} />); expect(screen.getByText('court (net refunds)')).toBeInTheDocument(); expect(screen.getByText('-₹420')).toBeInTheDocument(); expect(container.querySelector('.bg-chart-3')).toHaveStyle({ width: '100%' }); });
});
