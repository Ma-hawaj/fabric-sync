import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { byPosition } from '../lib/order-stage-order'
import type { OrderStage } from '../types/order-stage'

// PATCH accepts any subset of the fields, so this serves both the edit form
// (which sends all of them) and the list page's activate/deactivate action
// (which sends only `isActive`).
export interface UpdateOrderStageInput {
  id: string
  name?: string
  sortOrder?: number
  requiresDelivery?: boolean
  isActive?: boolean
}

async function updateOrderStage({
  id,
  ...changes
}: UpdateOrderStageInput): Promise<OrderStage> {
  const response = await fetch(`${apiBaseUrl}/order-stages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to update order stage (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useUpdateOrderStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateOrderStage,
    onSuccess: (stage) => {
      queryClient.setQueryData<OrderStage[]>(['order-stages'], (stages = []) =>
        stages
          .map((entry) => (entry.id === stage.id ? stage : entry))
          .sort(byPosition),
      )
      // Retiring or reordering a stage rewrites every order's checklist, since
      // the checklist is derived from this list rather than stored per order.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
