import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Product } from '../types/product'

async function fetchProduct(productId: string): Promise<Product> {
  const { data } = await apiClient.get<Product>(`/products/${productId}`)
  return data
}

/**
 * One product. `['products']` is the list; this keys off
 * `['products', id]` beneath it — a prefix of the list key, so the same
 * `invalidateQueries({ queryKey: ['products'] })` mutations already do also
 * refetch this page with no extra wiring.
 *
 * Pass `null` to hold the query until an id is known (the "new" forms).
 */
export function useProduct(productId: string | null) {
  return useQuery({
    queryKey: ['products', productId],
    queryFn: () => fetchProduct(productId as string),
    enabled: productId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
