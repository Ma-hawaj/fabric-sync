import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { byPosition } from '../lib/order-stage-order'
import type { OrderStage } from '../types/order-stage'
import type { OrderStageFormValues } from '../types/order-stage-form'

async function createOrderStage(
  values: OrderStageFormValues,
): Promise<OrderStage> {
  const { data } = await apiClient.post<OrderStage>('/order-stages', {
    name: values.name,
    sortOrder: Number(values.sortOrder),
    requiresDelivery: values.requiresDelivery,
  })
  return data
}

export function useCreateOrderStage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createOrderStage,
    onSuccess: (stage) => {
      // Patching the cache rather than invalidating keeps the orders page's
      // checklist in step without a refetch.
      queryClient.setQueryData<OrderStage[]>(['order-stages'], (stages = []) =>
        [...stages, stage].sort(byPosition),
      )
      // An order's checklist is derived from this list, so every order's
      // stages and current stage change the moment the catalog does.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
