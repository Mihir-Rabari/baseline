import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import plans from '@/mocks/plans.json';
import { PlanPicker } from '../../../../../apps/web/src/components/club/plan-picker';

describe('PlanPicker', () => {
  it('shows prices, entitlements and selection', () => {
    const change = vi.fn();
    render(<PlanPicker plans={plans} value={plans[0].id} onChange={change} />);
    expect(screen.getByRole('button', { name: /Gold/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/₹3,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Silver/ }));
    expect(change).toHaveBeenCalledWith(plans[1].id);
  });
  it('supports keyboard selection and disabled behavior', async () => {
    const change = vi.fn();
    const { rerender } = render(<PlanPicker plans={plans} value="" onChange={change} />);
    const user = userEvent.setup();
    await user.tab(); await user.keyboard('{Enter}');
    expect(change).toHaveBeenCalledWith(plans[0].id);
    rerender(<PlanPicker plans={plans} value="" onChange={change} disabled />);
    expect(screen.getByRole('button', { name: /Gold/ })).toBeDisabled();
  });
});
