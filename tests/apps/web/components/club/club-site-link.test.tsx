import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClubSiteLink } from '../../../../../apps/web/src/components/club/club-site-link';
const club = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ api: { public: { club } } }));
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ClubSiteLink /></QueryClientProvider>);
describe('ClubSiteLink', () => {
  it('links to the slugged club site', async () => {
    club.mockResolvedValue({ name: 'Baseline Sports Club' });
    show();
    expect(await screen.findByText('/site/baseline-sports-club')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/site/baseline-sports-club');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });
  it('renders nothing when the club cannot be loaded', async () => {
    club.mockRejectedValue(new Error('down'));
    const { container } = show();
    await vi.waitFor(() => expect(club).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
