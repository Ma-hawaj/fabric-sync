import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order, PaymentType } from '../types/orders'

interface CollectOrderInput {
  orderId: string
  /** Collected at this pickup; zero collects with no money. */
  amount: number
  /** Required whenever the amount is greater than zero. */
  paymentType: PaymentType | null
}

async function collectOrder({
  orderId,
  amount,
  paymentType,
}: CollectOrderInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${orderId}/collect`, {
    amount,
    paymentType,
  })
  return data
}

export function useCollectOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: collectOrder,
    onSuccess: () => {
      // A pickup records a payment against the shared invoice, so the
      // invoice list is stale too — not just this order's row.
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}
