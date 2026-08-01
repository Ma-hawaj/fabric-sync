import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import type { Order } from '../types/orders'

interface CreateRepairInput {
  orderId: string
  reason: string
  charge: number
  notes?: string
}

async function createRepair({
  orderId,
  ...body
}: CreateRepairInput): Promise<Order> {
  const response = await fetch(`${apiBaseUrl}/orders/${orderId}/repairs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to log repair (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useCreateRepair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createRepair,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
