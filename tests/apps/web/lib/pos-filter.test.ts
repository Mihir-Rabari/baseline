import { describe, expect, it } from 'vitest';
import type { Product } from '@packages/validation';
import {
  filterPosProducts,
  findBarcodeOrExactSkuMatch,
  calculateCashChange,
  getQuickCashNotesPaise,
} from '../../../../apps/web/src/lib/pos-filter';

const mockProducts: Product[] = [
  {
    id: 'p-1',
    sku: 'SKU-001',
    name: 'Control Tennis Racket',
    category: 'RACKET',
    pricePaise: 650000,
    yourPricePaise: 650000,
    discountPct: 0,
    stockQty: 10,
    inStock: true,
    lowStock: false,
    imageUrl: null,
  },
  {
    id: 'p-2',
    sku: 'SKU-002',
    name: 'Tennis Balls 3-Pack',
    category: 'BALL',
    pricePaise: 60000,
    yourPricePaise: 60000,
    discountPct: 0,
    stockQty: 2,
    inStock: true,
    lowStock: true,
    imageUrl: null,
  },
  {
    id: 'p-3',
    sku: 'SKU-003',
    name: 'Pro Court Shoes',
    category: 'SHOE',
    pricePaise: 890000,
    yourPricePaise: 890000,
    discountPct: 0,
    stockQty: 0,
    inStock: false,
    lowStock: false,
    imageUrl: null,
  },
];

describe('pos-filter helpers', () => {
  it('filters by category', () => {
    const rackets = filterPosProducts(mockProducts, { category: 'RACKET' });
    expect(rackets).toHaveLength(1);
    expect(rackets[0].sku).toBe('SKU-001');

    const all = filterPosProducts(mockProducts, { category: 'ALL' });
    expect(all).toHaveLength(3);
  });

  it('filters by search query matching name or sku', () => {
    const byName = filterPosProducts(mockProducts, { q: 'shoes' });
    expect(byName).toHaveLength(1);
    expect(byName[0].sku).toBe('SKU-003');

    const bySku = filterPosProducts(mockProducts, { q: 'SKU-002' });
    expect(bySku).toHaveLength(1);
    expect(bySku[0].name).toBe('Tennis Balls 3-Pack');
  });

  it('filters by inStockOnly', () => {
    const inStock = filterPosProducts(mockProducts, { inStockOnly: true });
    expect(inStock).toHaveLength(2);
    expect(inStock.some((p) => p.sku === 'SKU-003')).toBe(false);
  });

  it('finds exact barcode / SKU match', () => {
    const exact = findBarcodeOrExactSkuMatch(mockProducts, 'sku-001');
    expect(exact?.name).toBe('Control Tennis Racket');

    const nonExistent = findBarcodeOrExactSkuMatch(mockProducts, 'NON-EXISTENT');
    expect(nonExistent).toBeNull();
  });

  it('calculates cash change correctly', () => {
    expect(calculateCashChange(650000, 700000)).toBe(50000);
    expect(calculateCashChange(650000, 650000)).toBe(0);
    expect(calculateCashChange(650000, 500000)).toBe(0);
  });

  it('suggests quick cash notes', () => {
    const notes = getQuickCashNotesPaise(65000); // ₹650
    expect(notes).toContain(65000); // Exact
    expect(notes).toContain(100000); // ₹1,000
    expect(notes).toContain(200000); // ₹2,000
  });
});
