import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema } from '@packages/validation';
import fixture from '@/mocks/availability.json';
import friday from '@/mocks/availability-friday.json';
import { SlotGrid } from '../../../../../apps/web/src/components/club/slot-grid';

describe('slot grid', () => {
  it('selects free slots, disables occupied cells and greys overlapping starts', () => {
    const data = AvailabilitySchema.parse(fixture);
    const onSelect = vi.fn();
    const first = data.courts[0].slots[0];
    const { rerender } = render(<SlotGrid data={data} selected={null} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: 'Tennis Court 1, 8:30 am, ₹600' });
    fireEvent.click(button); expect(onSelect).toHaveBeenCalledWith(data.courts[0].courtId, first);
    const booked = screen.getByRole('button', { name: /Tennis Court 1.*Booked/ });
    expect(booked).toBeDisabled(); fireEvent.click(booked); expect(onSelect).toHaveBeenCalledOnce();
    rerender(<SlotGrid data={data} selected={{ courtId: data.courts[0].courtId, startsAt: first.startsAt }} onSelect={onSelect} />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tennis Court 1, 9:00 am, ₹600' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Padel Court 1, 9:00 am, ₹600' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Court availability' })).toHaveClass('overflow-x-auto');
  });
  it('shows social capacity, blocks full sessions and handles mixed slot durations', () => {
    const data = AvailabilitySchema.parse(friday);
    render(<SlotGrid data={data} selected={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /3 of 8 left/ })).toHaveLength(5);
    expect(screen.getByRole('button', { name: /Tennis Court 1.*Full/ })).toBeDisabled();
  });
});
