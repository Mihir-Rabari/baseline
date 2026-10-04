import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubSite } from '@/lib/club-site';
import ClubSitePage from '../../../../../../apps/web/src/app/site/[slug]/page';

const state = vi.hoisted(() => ({ site: null as unknown }));
vi.mock('@/lib/club-site', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/club-site')>()), getClubSite: async () => state.site }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/components/ui/theme-toggle', () => ({ ThemeToggle: () => <button type="button">Theme</button> }));

const site: ClubSite = {
  club: {
    name: 'Baseline Sports Club', tagline: 'Courts, coaching and a bar under one roof.', phone: '+91 98765 43210', address: '14 Cubbon Park Road, Bengaluru',
    hours: { open: '06:00', close: '22:00' }, timezone: 'Asia/Kolkata',
    courtTypes: [
      { id: 'c1', code: 'BADMINTON', name: 'Badminton', baseRatePaise: 40000, trialFeePaise: 14900, courtCount: 2 },
      { id: 'c2', code: 'PADEL', name: 'Padel', baseRatePaise: 80000, trialFeePaise: 19900, courtCount: 3 },
    ],
    socialPlay: { weekday: 5, startsTime: '18:00', endsTime: '22:00' },
  },
  plans: [
    { id: 'p1', code: 'GOLD', name: 'Gold', description: 'Premium, full access', monthlyFeePaise: 300000, courtDiscountPct: 100, shopDiscountPct: 15, barDiscountPct: 10, maxBookingsPerDay: 2, bookingHorizonDays: 14, minAge: null, maxAge: null, isActive: true },
    { id: 'p2', code: 'JUNIOR', name: 'Junior', description: null, monthlyFeePaise: 80000, courtDiscountPct: 50, shopDiscountPct: 0, barDiscountPct: 0, maxBookingsPerDay: 2, bookingHorizonDays: 7, minAge: null, maxAge: 17, isActive: true },
  ],
  products: [{ id: 'x1', name: 'Club Cap', category: 'ACCESSORY', pricePaise: 29900, inStock: true }],
  freeToday: { BADMINTON: 12, PADEL: 4 },
  branding: null,
};
const render_ = async (slug: string) => render(await ClubSitePage({ params: Promise.resolve({ slug }) }));

beforeEach(() => { state.site = site; });

describe('club website /site/:slug', () => {
  it('builds the page from the club data: headline, proof, courts, social play, plans, shop and contact', async () => {
    await render_('baseline-sports-club');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Courts, coaching and a bar under one roof.');
    expect(screen.getByText(/5 courts for badminton and padel, open every day, 6 am to 10 pm/)).toBeInTheDocument();
    const proof = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(proof).toEqual(expect.arrayContaining(['5', '16']));
    expect(screen.getByRole('heading', { name: 'Social play on Fridays' })).toBeInTheDocument();
    expect(screen.getByText(/Fridays, 6 pm to 10 pm/)).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('Club Cap')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+91 98765 43210' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(screen.getByText('14 Cubbon Park Road, Bengaluru')).toBeInTheDocument();
  });

  it('shows prices in rupees, free sessions per sport and member perks per plan', async () => {
    await render_('baseline-sports-club');
    const [courts, membership] = screen.getAllByRole('table');
    const badminton = within(courts).getByRole('row', { name: /Badminton/ });
    expect(badminton).toHaveTextContent('₹400');
    expect(badminton).toHaveTextContent('₹149');
    expect(badminton).toHaveTextContent('12');
    const gold = within(membership).getByRole('row', { name: /Gold/ });
    expect(gold).toHaveTextContent('₹3,000');
    expect(gold).toHaveTextContent('Courts included');
    expect(gold).toHaveTextContent('15% off');
    expect(gold).toHaveTextContent('14 days');
    expect(within(membership).getByRole('row', { name: /Junior/ })).toHaveTextContent('Under 18s');
    expect(screen.getByRole('link', { name: 'Ask about Gold' })).toHaveAttribute('href', '/contact?plan=GOLD');
  });

  it('points the main actions at the trial booking page and membership enquiry', async () => {
    await render_('baseline-sports-club');
    expect(screen.getAllByRole('link', { name: /Book a trial/ }).every((a) => a.getAttribute('href') === '/play')).toBe(true);
    expect(screen.getByRole('link', { name: 'See membership' })).toHaveAttribute('href', '#membership');
    expect(screen.getByRole('link', { name: 'Send an enquiry' })).toHaveAttribute('href', '/contact');
  });

  it("applies the club's palette as theme variables and shows its logo, ignoring unsafe values", async () => {
    state.site = { ...site, branding: { logoUrl: 'https://cdn.example.org/logo.png', primaryColor: '#ff0000', secondaryColor: 'red; background:url(//evil)', accentColor: null } };
    const { container } = await render_('baseline-sports-club');
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--primary')).toBe('0 100% 50%');
    expect(root.style.getPropertyValue('--secondary')).toBe('');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.org/logo.png');
  });

  it('leaves out sections that have no data instead of showing empty ones', async () => {
    state.site = { ...site, plans: [], products: [], freeToday: null, club: { ...site.club, tagline: '', phone: '', address: '' } };
    await render_('baseline-sports-club');
    expect(screen.queryByText('Membership', { selector: 'h2' })).not.toBeInTheDocument();
    expect(screen.queryByText('In the pro shop')).not.toBeInTheDocument();
    expect(screen.queryByText('Free sessions today')).not.toBeInTheDocument();
    expect(screen.queryByText('Phone')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Play more at Baseline Sports Club.');
  });

  it('is a 404 for a different slug or when the club cannot be read', async () => {
    await expect(ClubSitePage({ params: Promise.resolve({ slug: 'someone-elses-club' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    state.site = null;
    await expect(ClubSitePage({ params: Promise.resolve({ slug: 'baseline-sports-club' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
