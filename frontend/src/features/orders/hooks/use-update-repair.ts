import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
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
  const { data } = await apiClient.patch<Order>(
    `/orders/${orderId}/repairs/${repairId}`,
    changes,
  )
  return data
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
