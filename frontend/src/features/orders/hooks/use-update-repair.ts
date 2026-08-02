import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import type { Order, RepairStatus } from '../types/orders'

// PATCH accepts any subset, so this serves both the Complete/Cancel actions
// (which send only `status`) and any later edit of the reason or charge.
interface UpdateRepairInput {
  orderId: string
  repairId: string
  reason?: string
  charge?: number
  status?: RepairStatus
  notes?: string
}

async function updateRepair({
  orderId,
  repairId,
  ...changes
}: UpdateRepairInput): Promise<Order> {
  const response = await fetch(
    `${apiBaseUrl}/orders/${orderId}/repairs/${repairId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    },
  )
  if (!response.ok) {
    throw new ApiError(
      `Failed to update repair (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useUpdateRepair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateRepair,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
