import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order, PaymentType } from '../types/orders'

interface ReceiveOrderInput {
  orderId: string
  paymentType: PaymentType
}

async function receiveOrder({
  orderId,
  paymentType,
}: ReceiveOrderInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${orderId}/receive`, {
    paymentType,
  })
  return data
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
