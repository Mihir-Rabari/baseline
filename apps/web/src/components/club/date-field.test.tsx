import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from './date-field';
describe('DateField', () => {
  afterEach(() => vi.useRealTimers());
  it('uses club-local bounds and rejects outside dates', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T19:00:00Z'));
    const change = vi.fn(); render(<DateField value="2026-10-03" onChange={change} min="2026-10-03" max="2026-10-05" />);
    const field = screen.getByLabelText('Date'); expect(field).toHaveAttribute('min', '2026-10-03'); expect(field).toHaveAttribute('max', '2026-10-05');
    fireEvent.change(field, { target: { value: '2026-10-06' } }); expect(change).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '2026-10-04' } }); expect(change).toHaveBeenCalledWith('2026-10-04');
  });
});
