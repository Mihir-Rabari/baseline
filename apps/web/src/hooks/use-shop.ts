'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductListQuery, QuoteOrderRequest, RestockRequest } from '@packages/validation';
import { shopApi } from '@/lib/shop-api';
export function useShopProducts(params: Partial<ProductListQuery>, access: 'public' | 'member' | 'staff' = 'staff', enabled = true) { return useQuery({ queryKey: ['products', access, params], queryFn: () => shopApi.products(params, access), enabled, refetchInterval: 10000, staleTime: 5000 }); }
export function useShopQuote(input: QuoteOrderRequest, enabled: boolean, own = false) { return useQuery({ queryKey: ['shop-quote', input, own], queryFn: () => shopApi.quote(input, own), enabled: enabled && input.items.length > 0, staleTime: 0 }); }
export function useRestock() { const client = useQueryClient(); return useMutation({ mutationFn: ({ id, data }: { id: string; data: RestockRequest }) => shopApi.restock(id, data), onSuccess: () => client.invalidateQueries({ queryKey: ['products'] }) }); }
