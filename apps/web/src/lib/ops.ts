import type { PaginatedResponseMeta } from '@packages/validation';
import { fetchApi } from '@/lib/api-client';

/** A paginated API response. */
export type Page<T> = { data: T[]; meta: PaginatedResponseMeta };

/** Thin typed wrapper over the authenticated REST API for the operations screens (/api/v1 prefix added). */
const base = '/api/v1';

export const ops = {
  get: <T>(path: string) => fetchApi<T>(`${base}${path}`),
  post: <T>(path: string, body?: object) => fetchApi<T>(`${base}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: object) => fetchApi<T>(`${base}${path}`, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: object) => fetchApi<T>(`${base}${path}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => fetchApi<T>(`${base}${path}`, { method: 'DELETE' }),
};

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}` : '';
}
