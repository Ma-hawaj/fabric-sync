import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order } from '../types/orders'

interface CreateRepairInput {
  orderId: string
  reason: string
  charge: number
  notes?: string
}

async function createRepair({
  orderId,
  ...body
}: CreateRepairInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(
    `/orders/${orderId}/repairs`,
    body,
  )
  return data
}

export function useCreateRepair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createRepair,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
