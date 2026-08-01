import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { byPosition } from '../lib/order-stage-order'
import type { OrderStage } from '../types/order-stage'
import type { OrderStageFormValues } from '../types/order-stage-form'

async function createOrderStage(
  values: OrderStageFormValues,
): Promise<OrderStage> {
  const response = await fetch(`${apiBaseUrl}/order-stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: values.name,
      sortOrder: Number(values.sortOrder),
      requiresDelivery: values.requiresDelivery,
    }),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to create order stage (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
