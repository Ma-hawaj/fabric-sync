import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { OrderStage } from '../types/order-stage'

async function fetchOrderStages(): Promise<OrderStage[]> {
  const { data } = await apiClient.get<OrderStage[]>('/order-stages')
  return data
}

export function useOrderStages() {
  return useQuery({
    queryKey: ['order-stages'],
    queryFn: fetchOrderStages,
    staleTime: 1000 * 60 * 5,
  })
}
