import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockTime, getClubSite, hoursText, joinList, slugify, telHref } from '../../../../apps/web/src/lib/club-site';

afterEach(() => { vi.unstubAllGlobals(); });

describe('club site helpers', () => {
  it('slugifies club names', () => {
    expect(slugify('Baseline Sports Club')).toBe('baseline-sports-club');
    expect(slugify('  Smash & Serve — Café!  ')).toBe('smash-and-serve-cafe');
    expect(slugify('***')).toBe('');
  });
  it('formats clock times and opening hours', () => {
    expect(clockTime('06:00')).toBe('6 am');
    expect(clockTime('18:30')).toBe('6:30 pm');
    expect(clockTime('00:00')).toBe('12 am');
    expect(clockTime('12:00')).toBe('12 pm');
    expect(hoursText({ hours: { open: '06:00', close: '22:00' } })).toBe('6 am to 10 pm');
  });
  it('joins lists in plain English and builds tel links', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['padel'])).toBe('padel');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(telHref('+91 98765-43210')).toBe('tel:+919876543210');
  });
});

describe('getClubSite', () => {
  const club = { name: 'C', tagline: '', phone: '', address: '', hours: { open: '06:00', close: '22:00' }, timezone: 'Asia/Kolkata', courtTypes: [], socialPlay: { weekday: 5, startsTime: '18:00', endsTime: '22:00' } };
  const respond = (routes: Record<string, unknown | number>) => vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((path) => url.includes(path));
    const value = key ? routes[key] : 404;
    return typeof value === 'number' ? new Response('{}', { status: value }) : new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  });

  it('returns null when the club itself cannot be read', async () => {
    vi.stubGlobal('fetch', respond({ '/public/club': 503 }));
    expect(await getClubSite()).toBeNull();
  });

  it('still returns the club when plans, products and availability fail', async () => {
    vi.stubGlobal('fetch', respond({ '/public/club': club, '/public/plans': 500, '/public/products': 500, '/public/availability': 500 }));
    expect(await getClubSite()).toEqual({ club, plans: [], products: [], freeToday: null, branding: null });
  });

  it('counts only free sessions per sport and hides sold-out products', async () => {
    vi.stubGlobal('fetch', respond({
      '/public/club': club, '/public/plans': [],
      '/public/products': { data: [{ id: '1', name: 'In', category: 'BALL', pricePaise: 100, inStock: true }, { id: '2', name: 'Out', category: 'BALL', pricePaise: 100, inStock: false }] },
      '/public/availability': { courts: [{ type: 'PADEL', slots: [{ status: 'FREE' }, { status: 'BOOKED' }] }, { type: 'PADEL', slots: [{ status: 'FREE' }] }, { type: 'TENNIS', slots: [{ status: 'PAST' }] }] },
    }));
    const site = await getClubSite(new Date('2026-10-03T08:00:00Z'));
    expect(site?.freeToday).toEqual({ PADEL: 2, TENNIS: 0 });
    expect(site?.products.map((p) => p.name)).toEqual(['In']);
  });

  it('asks for the availability of the club\'s own calendar day', async () => {
    const fetch = respond({ '/public/club': club, '/public/plans': [], '/public/products': { data: [] }, '/public/availability': { courts: [] } });
    vi.stubGlobal('fetch', fetch);
    await getClubSite(new Date('2026-10-03T20:00:00Z')); // 01:30 IST on 4 October
    expect(fetch.mock.calls.map(([url]) => url as string).find((url) => url.includes('availability'))).toContain('date=2026-10-04');
  });
});
