import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '../../../../../apps/web/src/app/(marketing)/page';
const availability = vi.hoisted(() => ({ value: { data: { courts: [{ slots: [{ status: 'FREE' }, { status: 'BOOKED' }, { status: 'FREE' }] }] }, isPending: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/use-public-availability', () => ({ usePublicAvailability: () => availability.value }));
describe('Club landing', () => {
  it('shows live availability and keeps booking, membership and shop links', () => {
    render(<HomePage />);
    expect(screen.getByRole('status')).toHaveTextContent('2 free slot starts today');
    expect(screen.getByRole('link', { name: 'Find a free court' })).toHaveAttribute('href', '/play');
    expect(screen.getByRole('link', { name: 'Compare membership plans' })).toHaveAttribute('href', '/plans');
    expect(screen.getByRole('link', { name: 'Browse the shop' })).toHaveAttribute('href', '/shop');
  });
  it('serves three optimized local photos with alt text, reserved dimensions and responsive sizes', () => {
    render(<HomePage />);
    const photos = screen.getAllByRole('img');
    expect(photos).toHaveLength(3);
    for (const photo of photos) {
      expect(photo).toHaveAttribute('alt');
      expect(photo.getAttribute('alt')?.length).toBeGreaterThan(20);
      expect(photo).toHaveAttribute('width');
      expect(photo).toHaveAttribute('height');
      expect(photo.getAttribute('sizes')).toContain('100vw');
      expect(photo.getAttribute('srcset')).toContain('/_next/image?');
      expect(photo.getAttribute('src')).toContain('images%2Flanding%2F');
    }
    expect(photos[0]).not.toHaveAttribute('loading', 'lazy');
    expect(photos[1]).toHaveAttribute('loading', 'lazy');
    expect(photos[2]).toHaveAttribute('loading', 'lazy');
  });
  it('keeps the photo layout and a loading announcement while availability loads', () => {
    availability.value.isPending = true;
    try {
      render(<HomePage />);
      expect(screen.getByRole('status', { name: "Checking today's court availability" })).toBeInTheDocument();
      expect(screen.getAllByRole('img')).toHaveLength(3);
    } finally { availability.value.isPending = false; }
  });
  it('keeps imagery and retry available when the live service fails', () => {
    availability.value.error = new Error('Availability unavailable');
    try {
      render(<HomePage />);
      expect(screen.getByRole('alert')).toHaveTextContent('Availability unavailable');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(availability.value.refetch).toHaveBeenCalledOnce();
      expect(screen.getAllByRole('img')).toHaveLength(3);
    } finally { availability.value.error = null; }
  });
  it('offers another date when no free slots remain', () => {
    const courts = availability.value.data.courts;
    availability.value.data.courts = [];
    try {
      render(<HomePage />);
      expect(screen.getByRole('status')).toHaveTextContent('No free slots left today. Check another date.');
      expect(screen.getByRole('link', { name: 'Find a free court' })).toHaveAttribute('href', '/play');
    } finally { availability.value.data.courts = courts; }
  });
});
