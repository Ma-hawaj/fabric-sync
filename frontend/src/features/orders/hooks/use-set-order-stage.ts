import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order, OrderStageStatus } from '../types/orders'

interface SetOrderStageInput {
  orderId: string
  stageId: string
  status: OrderStageStatus
  /** Required when completing a stage that needs a delivery. */
  locationId?: string
  notes?: string
}

async function setOrderStage({
  orderId,
  stageId,
  ...body
}: SetOrderStageInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(
    `/orders/${orderId}/stages/${stageId}`,
    body,
  )
  return data
}

export function useSetOrderStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setOrderStage,
    onSuccess: () => {
      // One stage change moves the derived current stage, so the whole row is
      // refetched rather than patched.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
