import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Money } from './money';
import { StatusBadge } from './status-badge';
import { PageError } from './page-error';

describe('club components', () => {
  it('renders money with tabular figures and optional styling', () => {
    render(<Money paise={42050} className="text-sm" />);
    expect(screen.getByText('₹420.50')).toHaveClass('tabular', 'text-sm');
  });

  it.each([
    ['booking', 'CONFIRMED', 'Confirmed', 'text-success'],
    ['membership', 'EXPIRING_SOON', 'Expiring soon', 'text-warning'],
    ['membership', 'EXPIRED', 'Expired', 'bg-destructive'],
    ['order', 'OUT_FOR_DELIVERY', 'Out for delivery', 'text-warning'],
    ['lead', 'WON', 'Won', 'text-success'],
    ['invoice', 'PAID', 'Paid', 'text-success'],
    ['stock', 'OUT', 'Out', 'bg-destructive'],
  ] as const)('labels %s status %s with its semantic colour', (kind, value, label, className) => {
    render(<StatusBadge kind={kind} value={value} />);
    expect(screen.getByText(label)).toHaveClass(className);
  });

  it('handles unknown statuses without presenting them as success', () => {
    render(<StatusBadge kind="booking" value="toString" />);
    expect(screen.getByText('Unknown status')).toHaveClass('text-foreground');
  });

  it('shows the error and retries only when requested', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<PageError error={new Error('Service unavailable')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<PageError error={new Error('Service unavailable')} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
