import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './page';
vi.mock('@/hooks/use-public-availability', () => ({ usePublicAvailability: () => ({ data: { courts: [{ slots: [{ status: 'FREE' }, { status: 'BOOKED' }, { status: 'FREE' }] }] }, isPending: false }) }));
describe('Club landing', () => { it('shows a live free slot proof and directs visitors to booking', () => { render(<HomePage />); expect(screen.getByRole('status')).toHaveTextContent('2 free slot starts today'); expect(screen.getByRole('link', { name: 'Find a free court' })).toHaveAttribute('href', '/play'); }); });
