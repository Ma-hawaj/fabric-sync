import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Customer, Measurement } from '../types/customers'

type CustomerDto = Omit<Customer, 'measurements'> & {
  measurements?: (Omit<Measurement, 'date'> & { date: string })[]
}

async function fetchCustomer(customerId: string): Promise<Customer> {
  const { data } = await apiClient.get<CustomerDto>(`/customers/${customerId}`)
  return {
    ...data,
    // Dates arrive as ISO strings off the wire; the rest of the app expects
    // real Dates (the customer sheet renders them the same way).
    measurements: (data.measurements ?? []).map((measurement) => ({
      ...measurement,
      date: new Date(measurement.date),
    })),
  }
}

/**
 * One customer with its full measurement history. `['customers']` is the
 * list; this keys off `['customers', id]` beneath it — a prefix of the list
 * key, so the same `invalidateQueries({ queryKey: ['customers'] })`
 * mutations already do also refetch this page with no extra wiring.
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
