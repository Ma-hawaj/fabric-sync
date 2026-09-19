import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Measurement } from '@/features/customers/types/customers'
import type { OrderDetail } from '../types/orders'

interface OrderDetailDto extends Omit<
  OrderDetail,
  'invoiceDate' | 'measurement'
> {
  invoiceDate: string
  measurement: Omit<Measurement, 'date'> & { date: string }
}

async function fetchOrder(orderId: string): Promise<OrderDetail> {
  const { data } = await apiClient.get<OrderDetailDto>(`/orders/${orderId}`)
  return {
    ...data,
    // Dates arrive as ISO strings off the wire; the rest of the app expects
    // real Dates (the list hook parses invoiceDate the same way).
    invoiceDate: new Date(data.invoiceDate),
    measurement: { ...data.measurement, date: new Date(data.measurement.date) },
  }
}

/**
 * One order with its full detail. `['orders']` is the list; this keys off
 * `['orders', id]` beneath it — a prefix of the list key, so the same
 * `invalidateQueries({ queryKey: ['orders'] })` mutations already do also
 * refetch this page with no extra wiring.
 *
 * Pass `null` to hold the query until an order is selected.
 */
export function useOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['orders', orderId],
    queryFn: () => fetchOrder(orderId as string),
    enabled: orderId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
