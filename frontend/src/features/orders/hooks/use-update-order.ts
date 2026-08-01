import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import type { Order } from '../types/orders'

interface UpdateOrderInput {
  orderId: string
  productionLocationId: string
}

async function updateOrder({
  orderId,
  ...changes
}: UpdateOrderInput): Promise<Order> {
  const response = await fetch(`${apiBaseUrl}/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to update order (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useUpdateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateOrder,
    onSuccess: () => {
      // Assigning a production location can flip the delivery stage from "not
      // needed" to outstanding, which moves the current stage — refetch rather
      // than patching one row.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
