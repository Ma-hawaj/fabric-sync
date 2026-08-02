import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order } from '../types/orders'

async function fetchOrders(): Promise<Order[]> {
  const { data } =
    await apiClient.get<
      (Omit<Order, 'invoiceDate'> & { invoiceDate: string })[]
    >('/orders')
  return data.map((order) => ({
    ...order,
    invoiceDate: new Date(order.invoiceDate),
  }))
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
