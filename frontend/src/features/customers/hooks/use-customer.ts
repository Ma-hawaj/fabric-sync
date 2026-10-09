import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { toCustomer } from '../types/customers'
import type { Customer } from '../types/customers'

async function fetchCustomer(customerId: string): Promise<Customer> {
  const { data } = await apiClient.get(`/customers/${customerId}`)
  return toCustomer(data)
}

/**
 * One customer with its full measurement history and order history. The
 * response carries everything the customer sheet shows — no second request
 * filtered by phone number. `['customers']` is the list; this keys off
 * `['customers', id]` beneath it — a prefix of the list key, so the same
 * `invalidateQueries({ queryKey: ['customers'] })` mutations already do also
 * refetch this page with no extra wiring.
 *
 * Pass `null` to hold the query until an id is known (the "new" forms).
 */
export function useCustomer(customerId: string | null) {
  return useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => fetchCustomer(customerId as string),
    enabled: customerId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
