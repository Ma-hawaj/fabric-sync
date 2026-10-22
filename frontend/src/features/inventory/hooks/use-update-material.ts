import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Material } from '../types/inventory'
import type { MaterialEditValues } from '../lib/material-edit-schema'

export function useUpdateMaterial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      materialId,
      values,
    }: {
      materialId: string
      values: MaterialEditValues
    }) =>
      (
        await apiClient.patch<Material>(`/materials/${materialId}`, {
          ...values,
          name: values.name.trim(),
          unit: values.unit.trim(),
          sku: values.sku.trim() || null,
          family: values.family.trim() || null,
        })
      ).data,
    onSuccess: () => {
      for (const key of [
        'materials',
        'invoice-order-material',
        'orders',
        'invoices',
      ])
        void queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
}
