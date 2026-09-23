import { useListQuery } from '@/hooks/use-list-query'
import type { Material } from '../types/inventory'

const ENDPOINT = '/materials'
const QUERY_KEY = 'materials'
const ALL = new URLSearchParams()

export function useInventory(searchParams: URLSearchParams) {
  return useListQuery<Material>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams,
  })
}

/**
 * The whole list, unpaginated — the form pickers need every row to populate a
 * combobox. An empty request omits `perPage`, which is what tells the API not to
 * page. The key shares the `materials` prefix with the paginated hook, so one
 * invalidation refreshes both.
 */
export function useAllInventory() {
  return useListQuery<Material>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams: ALL,
  })
}
