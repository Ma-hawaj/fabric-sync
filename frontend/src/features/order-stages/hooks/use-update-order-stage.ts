import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
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
  const { data } = await apiClient.patch<OrderStage>(
    `/order-stages/${id}`,
    changes,
  )
  return data
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
