import { useListQuery } from '@/hooks/use-list-query'
import type { Product } from '../types/product'

const ENDPOINT = '/products'
const QUERY_KEY = 'products'
const ALL = new URLSearchParams()

// Returns inactive products too — the products page lists them behind a status
// filter, and the invoice form narrows to the active ones itself.
export function useProducts(searchParams: URLSearchParams) {
  return useListQuery<Product>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams,
  })
}

/**
 * The whole list, unpaginated — the form pickers need every row to populate a
 * combobox. An empty request omits `perPage`, which is what tells the API not to
 * page. The key shares the `products` prefix with the paginated hook, so one
 * invalidation refreshes both.
 */
export function useAllProducts() {
  return useListQuery<Product>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams: ALL,
  })
}
