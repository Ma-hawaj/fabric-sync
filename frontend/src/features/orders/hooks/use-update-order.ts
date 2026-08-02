import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order } from '../types/orders'

interface UpdateOrderInput {
  orderId: string
  productionLocationId: string
}

async function updateOrder({
  orderId,
  ...changes
}: UpdateOrderInput): Promise<Order> {
  const { data } = await apiClient.patch<Order>(`/orders/${orderId}`, changes)
  return data
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
