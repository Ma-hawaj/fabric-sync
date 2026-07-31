import { useListQuery } from '@/hooks/use-list-query'
import type { Customer } from '../types/customers'

const ENDPOINT = '/customers'
const QUERY_KEY = 'customers'
const ALL = new URLSearchParams()

export function useCustomers(searchParams: URLSearchParams) {
  return useListQuery<Customer>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams,
  })
}

/**
 * The whole list, unpaginated — the form pickers need every row to populate a
 * combobox. An empty request omits `perPage`, which is what tells the API not to
 * page. The key shares the `customers` prefix with the paginated hook, so one
 * invalidation refreshes both.
 */
export function useAllCustomers() {
  return useListQuery<Customer>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams: ALL,
  })
}
