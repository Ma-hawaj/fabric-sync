import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Order } from '../types/orders'

interface SetAssigneeInput {
  orderId: string
  stageId: string
  /** Omitted or undefined clears the assignment. */
  assigneeId?: string
}

async function setAssignee({
  orderId,
  stageId,
  assigneeId,
}: SetAssigneeInput): Promise<Order> {
  const { data } = await apiClient.put<Order>(
    `/orders/${orderId}/stages/${stageId}/assignee`,
    { assigneeId },
  )
  return data
}

export function useSetAssignee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setAssignee,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
