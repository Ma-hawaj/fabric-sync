import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order, PaymentType } from '../types/orders'

interface ReceiveRepairInput {
  orderId: string
  repairId: string
  amount: number
  paymentType: PaymentType | null
}

async function receiveRepair({
  orderId,
  repairId,
  amount,
  paymentType,
}: ReceiveRepairInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(
    `/orders/${orderId}/repairs/${repairId}/receive`,
    { amount, paymentType },
  )
  return data
}

export function useReceiveRepair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: receiveRepair,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['repairs'] })
    },
  })
}
