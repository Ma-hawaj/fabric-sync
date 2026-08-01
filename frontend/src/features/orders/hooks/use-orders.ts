import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl, apiFetch } from '@/lib/api'
import type { Order } from '../types/orders'

async function fetchOrders(): Promise<Order[]> {
  const response = await apiFetch(`${apiBaseUrl}/orders`)
  if (!response.ok) {
    throw new Error(`Failed to load orders (${response.status})`)
  }
  const orders: (Omit<Order, 'invoiceDate'> & { invoiceDate: string })[] =
    await response.json()
  return orders.map((order) => ({
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
