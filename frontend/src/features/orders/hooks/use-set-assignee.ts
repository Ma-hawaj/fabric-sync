import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
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
  const response = await fetch(
    `${apiBaseUrl}/orders/${orderId}/stages/${stageId}/assignee`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId }),
    },
  )
  if (!response.ok) {
    throw new ApiError(
      `Failed to update assignee (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
