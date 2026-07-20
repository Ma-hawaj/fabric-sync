import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Order } from '../types/orders'

async function fetchOrders(): Promise<Order[]> {
  const response = await fetch(`${apiBaseUrl}/orders`)
  if (!response.ok) {
    throw new Error(`Failed to load orders (${response.status})`)
  }
  return response.json()
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
