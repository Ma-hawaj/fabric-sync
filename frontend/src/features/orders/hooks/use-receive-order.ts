import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order, PaymentType } from '../types/orders'

interface ReceiveOrderInput {
  orderId: string
  /** Collected at this pickup; zero collects with no money. */
  amount: number
  /** Required whenever the amount is greater than zero. */
  paymentType: PaymentType | null
}

async function receiveOrder({
  orderId,
  amount,
  paymentType,
}: ReceiveOrderInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${orderId}/receive`, {
    amount,
    paymentType,
  })
  return data
}

export function useReceiveOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: receiveOrder,
    onSuccess: () => {
      // A pickup records a payment against the shared invoice, so the
      // invoice list is stale too — not just this order's row.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}
