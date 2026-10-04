'use client';

import { useQuery } from '@tanstack/react-query';
import type { Category, CategoryScope } from '@packages/validation';
import { fetchApi, USE_MOCKS } from '@/lib/api-client';
import { useOpsQuery } from '@/hooks/use-ops';

export const CATEGORY_PATHS: Record<CategoryScope, string> = {
  PRODUCT: '/products/categories',
  MENU: '/bar/categories',
};

/** Managed category list for a screen. Switched-off ones are included only when asked (management UI). */
export function useCategories(scope: CategoryScope, options: { enabled?: boolean; includeInactive?: boolean } = {}) {
  const includeInactive = options.includeInactive ?? false;
  return useOpsQuery<Category[]>(
    ['categories', scope, includeInactive],
    `${CATEGORY_PATHS[scope]}${includeInactive ? '?includeInactive=true' : ''}`,
    { enabled: options.enabled }
  );
}

/**
 * Select options for a category list. `current` keeps an item's existing category visible even when
 * it has since been switched off, so editing the item does not silently change it.
 */
export function categoryOptions(list: Category[] | undefined, current?: string) {
  const options = (list ?? []).filter((c) => c.isActive).map((c) => ({ value: c.code, label: c.name }));
  if (current && !options.some((o) => o.value === current)) {
    const known = (list ?? []).find((c) => c.code === current);
    options.push({ value: current, label: known ? `${known.name} (off)` : current });
  }
  return options;
}

/** Display name for a stored category code. */
export function categoryName(list: Category[] | undefined, code: string) {
  return list?.find((c) => c.code === code)?.name ?? code;
}

const MOCK_PUBLIC: Category[] = ['RACKET', 'BALL', 'SHOE', 'ACCESSORY', 'APPAREL'].map((code, i) => ({
  id: `00000000-0000-4000-8000-00000000010${i}`,
  scope: 'PRODUCT',
  code,
  name: code === 'ACCESSORY' ? 'Accessories' : `${code[0]}${code.slice(1).toLowerCase()}s`,
  sortOrder: i + 1,
  isActive: true,
}));

/** Storefront filter chips; no login required. */
export function usePublicProductCategories() {
  return useQuery({
    queryKey: ['categories', 'public-products'],
    queryFn: () => (USE_MOCKS ? Promise.resolve(MOCK_PUBLIC) : fetchApi<Category[]>('/api/v1/public/product-categories')),
    staleTime: 60_000,
  });
}
