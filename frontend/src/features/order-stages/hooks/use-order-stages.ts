import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { OrderStage } from '../types/order-stage'

async function fetchOrderStages(): Promise<OrderStage[]> {
  const response = await fetch(`${apiBaseUrl}/order-stages`)
  if (!response.ok) {
    throw new Error(`Failed to load order stages (${response.status})`)
  }
  return response.json()
}

export function useOrderStages() {
  return useQuery({
    queryKey: ['order-stages'],
    queryFn: fetchOrderStages,
    staleTime: 1000 * 60 * 5,
  })
}
