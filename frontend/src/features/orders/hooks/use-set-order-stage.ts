import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import type { Order, OrderStageStatus } from '../types/orders'

interface SetOrderStageInput {
  orderId: string
  stageId: string
  status: OrderStageStatus
  /** Omitted to act on the original build, set to act on a repair's pass. */
  repairId?: string
  /** Required when completing a stage that needs a delivery. */
  locationId?: string
  notes?: string
}

async function setOrderStage({
  orderId,
  stageId,
  ...body
}: SetOrderStageInput): Promise<Order> {
  const response = await fetch(
    `${apiBaseUrl}/orders/${orderId}/stages/${stageId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) {
    throw new ApiError(
      `Failed to update stage (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useSetOrderStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setOrderStage,
    onSuccess: () => {
      // One stage change moves the derived current stage and, on a repair's
      // pass, its status too — so the whole row is refetched.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
