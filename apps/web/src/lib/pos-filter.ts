import type { Product, PublicProduct, ProductCategory } from '@packages/validation';

export type PosCategory = 'ALL' | ProductCategory;

export const POS_CATEGORIES: Array<{ key: PosCategory; label: string }> = [
  { key: 'ALL', label: 'All items' },
  { key: 'RACKET', label: 'Rackets' },
  { key: 'BALL', label: 'Balls' },
  { key: 'SHOE', label: 'Shoes' },
  { key: 'ACCESSORY', label: 'Accessories' },
  { key: 'APPAREL', label: 'Apparel' },
];

export interface PosFilterOptions {
  q?: string;
  category?: PosCategory;
  inStockOnly?: boolean;
}

export function filterPosProducts<T extends Product | PublicProduct>(
  products: T[],
  options: PosFilterOptions
): T[] {
  const { q = '', category = 'ALL', inStockOnly = false } = options;
  const normalizedQuery = q.trim().toLowerCase();

  return products.filter((product) => {
    // 1. Category check
    if (category !== 'ALL' && product.category !== category) {
      return false;
    }

    // 2. In stock check
    if (inStockOnly && !product.inStock) {
      return false;
    }

    // 3. Search query check
    if (normalizedQuery) {
      const matchName = product.name.toLowerCase().includes(normalizedQuery);
      const matchSku = product.sku.toLowerCase().includes(normalizedQuery);
      const matchCategory = product.category.toLowerCase().includes(normalizedQuery);
      if (!matchName && !matchSku && !matchCategory) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Searches for an exact barcode or SKU match, or single exact-matching product.
 * Returns the matched product if found, or null otherwise.
 */
export function findBarcodeOrExactSkuMatch<T extends Product | PublicProduct>(
  products: T[],
  input: string
): T | null {
  const clean = input.trim().toLowerCase();
  if (!clean) return null;

  // Exact SKU match
  const exactSku = products.find((p) => p.sku.toLowerCase() === clean);
  if (exactSku) return exactSku;

  // Exact name match
  const exactName = products.find((p) => p.name.toLowerCase() === clean);
  if (exactName) return exactName;

  return null;
}

/**
 * Calculates change to return in paise given total and tendered amounts in paise.
 */
export function calculateCashChange(totalPaise: number, tenderedPaise: number): number {
  if (tenderedPaise <= totalPaise) return 0;
  return tenderedPaise - totalPaise;
}

/**
 * Suggests quick cash note amounts (in paise) for a given total amount in paise.
 */
export function getQuickCashNotesPaise(totalPaise: number): number[] {
  const commonNotesPaise = [10000, 20000, 50000, 100000, 200000]; // ₹100, ₹200, ₹500, ₹1000, ₹2000
  const higherNotes = commonNotesPaise.filter((note) => note > totalPaise);
  const notes = [totalPaise, ...higherNotes.slice(0, 4)];
  return Array.from(new Set(notes));
}
