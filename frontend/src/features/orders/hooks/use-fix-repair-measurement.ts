import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { measurementPayload } from '@/features/customers/hooks/use-create-customer'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'
import type { Order } from '../types/orders'

interface FixRepairMeasurementInput {
  orderId: string
  repairId: string
  measurement: MeasurementDraft
}

async function fixRepairMeasurement({
  orderId,
  repairId,
  measurement,
}: FixRepairMeasurementInput): Promise<Order> {
  const { data } = await apiClient.put<Order>(
    `/orders/${orderId}/repairs/${repairId}/measurement`,
    { measurement: measurementPayload(measurement) },
  )
  return data
}

export function useFixRepairMeasurement() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: fixRepairMeasurement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['repairs'] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}
