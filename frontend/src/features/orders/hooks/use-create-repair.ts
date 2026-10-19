import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { measurementPayload } from '@/features/customers/hooks/use-create-customer'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'
import type { Order } from '../types/orders'

interface CreateRepairInput {
  orderId: string
  reason: string
  charge: number
  notes?: string
  measurement?: MeasurementDraft
}

async function createRepair({
  orderId,
  measurement,
  ...body
}: CreateRepairInput): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/orders/${orderId}/repairs`, {
    ...body,
    ...(measurement ? { measurement: measurementPayload(measurement) } : {}),
  })
  return data
}

export function useCreateRepair() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createRepair,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['repairs'] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}
