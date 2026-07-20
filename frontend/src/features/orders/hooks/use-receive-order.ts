import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import type { Order } from '../types/orders'

async function receiveOrder(orderId: string): Promise<Order> {
  const response = await fetch(`${apiBaseUrl}/orders/${orderId}/receive`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to receive order (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useReceiveOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: receiveOrder,
    onSuccess: () => {
      // Receiving one order can flip the invoice's payment status for every
      // other order sharing it (once all are received), so refetch the whole
      // list rather than patching just this row.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
