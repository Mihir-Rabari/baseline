import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from './date-field';

describe('DateField', () => {
  afterEach(() => vi.useRealTimers());
  it('shows the chosen date, disables days outside the bounds and picks an allowed day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T19:00:00Z'));
    const change = vi.fn(); render(<DateField value="2026-10-03" onChange={change} min="2026-10-03" max="2026-10-05" />);
    const field = screen.getByLabelText('Date');
    expect(field).toHaveTextContent('3 Oct');
    fireEvent.click(field);
    expect(screen.getByRole('gridcell', { name: / 6 Oct/ })).toBeDisabled();
    expect(screen.getByRole('gridcell', { name: / 2 Oct/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('gridcell', { name: / 4 Oct/ }));
    expect(change).toHaveBeenCalledWith('2026-10-04');
  });
});
