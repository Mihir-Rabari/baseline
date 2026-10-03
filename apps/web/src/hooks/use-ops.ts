'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ops } from '@/lib/ops';

/** A GET query. `refetchMs` turns on polling for live screens (kitchen, tabs). */
export function useOpsQuery<T>(key: QueryKey, path: string, options: { enabled?: boolean; refetchMs?: number } = {}) {
  return useQuery({
    queryKey: key,
    queryFn: () => ops.get<T>(path),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchMs,
    staleTime: options.refetchMs ? Math.min(options.refetchMs, 5000) : 10000,
  });
}

type Method = 'post' | 'put' | 'patch' | 'delete';

/**
 * A write. `invalidate` lists the top-level query keys to refresh afterwards, so every screen that
 * shows the same data (orders, tabs, ledger) updates together.
 */
export function useOpsMutation<TRes, TBody extends object | undefined = object>(
  method: Method,
  invalidate: string[],
  path: (variables: TBody) => string
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: TBody) => {
      const url = path(variables);
      if (method === 'delete') return ops.delete<TRes>(url);
      return method === 'post' ? ops.post<TRes>(url, variables) : ops[method]<TRes>(url, (variables ?? {}) as object);
    },
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
}
