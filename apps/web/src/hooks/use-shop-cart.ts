'use client';
import { useState } from 'react';
import type { PublicProduct } from '@packages/validation';
export type CartLine = { product: PublicProduct; qty: number };
export function useShopCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  return { lines, add: (product: PublicProduct) => setLines((current) => { const exists = current.find((line) => line.product.id === product.id); return exists ? current.map((line) => line.product.id === product.id ? { ...line, qty: Math.min(1000, line.qty + 1) } : line) : [...current, { product, qty: 1 }]; }), quantity: (id: string, qty: number) => setLines((current) => qty <= 0 ? current.filter((line) => line.product.id !== id) : current.map((line) => line.product.id === id ? { ...line, qty: Math.min(1000, qty) } : line)), clear: () => setLines([]) };
}
