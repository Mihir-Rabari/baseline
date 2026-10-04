import type { Plan, PublicClub, TenantBranding } from '@packages/validation';
import { API_BASE_URL } from '@/lib/api-client';

export interface SiteProduct { id: string; name: string; category: string; pricePaise: number; inStock: boolean }
export interface ClubSite {
  club: PublicClub;
  plans: Plan[];
  products: SiteProduct[];
  /** The club's palette and logo; null when it could not be read. */
  branding: TenantBranding | null;
  /** Free sessions today per court type code, or null when availability could not be read. */
  freeToday: Record<string, number> | null;
}

/** `Baseline Sports Club` becomes `baseline-sports-club`. */
export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `18:00` to `6 pm`, `06:30` to `6:30 am`. */
export function clockTime(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

export const hoursText = (club: Pick<PublicClub, 'hours'>) => `${clockTime(club.hours.open)} to ${clockTime(club.hours.close)}`;

/** `Badminton, Cricket Nets and Padel`. */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** The host the visitor used, so the API serves the right club. Empty outside a request (tests, builds). */
async function requestHost(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const list = await headers();
    return list.get('x-forwarded-host') ?? list.get('host') ?? '';
  } catch {
    return '';
  }
}

async function getJson<T>(path: string): Promise<T> {
  const host = await requestHost();
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, { cache: 'no-store', ...(host ? { headers: { 'X-Tenant-Host': host } } : {}) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return (await response.json()) as T;
}

/** Everything the public website shows, read from the same public API the rest of the app uses. */
export async function getClubSite(today = new Date()): Promise<ClubSite | null> {
  let club: PublicClub;
  try {
    club = await getJson<PublicClub>('/public/club');
  } catch {
    return null;
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: club.timezone }).format(today);
  const [plans, products, availability, branding] = await Promise.allSettled([
    getJson<Plan[]>('/public/plans'),
    getJson<{ data: SiteProduct[] }>('/public/products?limit=8'),
    getJson<{ courts: Array<{ type: string; slots: Array<{ status: string; endsAt: string }> }> }>(`/public/availability?date=${date}`),
    getJson<TenantBranding>('/tenant/branding'),
  ]);
  let freeToday: Record<string, number> | null = null;
  if (availability.status === 'fulfilled') {
    freeToday = {};
    for (const court of availability.value.courts) {
      const free = court.slots.filter((slot) => slot.status === 'FREE').length;
      freeToday[court.type] = (freeToday[court.type] ?? 0) + free;
    }
  }
  return {
    club,
    plans: plans.status === 'fulfilled' ? plans.value : [],
    products: products.status === 'fulfilled' ? products.value.data.filter((p) => p.inStock) : [],
    branding: branding.status === 'fulfilled' ? branding.value : null,
    freeToday,
  };
}
