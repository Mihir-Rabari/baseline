'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProductListQuery,
  QuoteOrderRequest,
  RestockRequest,
  CreateProductRequest,
  UpdateProductRequest,
  AdjustStockRequest,
} from '@packages/validation';
import { shopApi } from '@/lib/shop-api';

export function useShopProducts(
  params: Partial<ProductListQuery>,
  access: 'public' | 'member' | 'staff' = 'staff',
  enabled = true
) {
  return useQuery({
    queryKey: ['products', access, params],
    queryFn: () => shopApi.products(params, access),
    enabled,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useShopQuote(input: QuoteOrderRequest, enabled: boolean, own = false) {
  return useQuery({
    queryKey: ['shop-quote', input, own],
    queryFn: () => shopApi.quote(input, own),
    enabled: enabled && input.items.length > 0,
    staleTime: 0,
  });
}

export function useRestock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RestockRequest }) => shopApi.restock(id, data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCreateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProductRequest) => shopApi.createProduct(data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useUpdateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductRequest }) =>
      shopApi.updateProduct(id, data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useAdjustStock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AdjustStockRequest }) =>
      shopApi.adjust(id, data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => shopApi.deleteProduct(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useProductMovements(productId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['products', productId, 'movements'],
    queryFn: () => (productId ? shopApi.movements(productId, 1, 50) : null),
    enabled: Boolean(productId && enabled),
  });
}
