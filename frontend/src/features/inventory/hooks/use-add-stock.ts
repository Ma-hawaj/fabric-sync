import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Material } from '../types/inventory'
import type { InventoryFormValues } from '../types/inventory-form'

function entriesPayload(values: InventoryFormValues) {
  return values.entries.map((entry) => ({
    locationId: entry.locationId,
    quantity: entry.quantity === '' ? 0 : entry.quantity,
  }))
}

// Both endpoints return the full updated material, so the cache can be
// patched from the response instead of refetching the whole list.
async function addStock(values: InventoryFormValues): Promise<Material> {
  const { data } =
    values.mode === 'existing'
      ? await apiClient.post<Material>(
          `/materials/${values.materialId}/stock`,
          { entries: entriesPayload(values) },
        )
      : await apiClient.post<Material>('/materials', {
          name: values.name,
          sku: values.sku.trim() || null,
          unit: values.unit,
          entries: entriesPayload(values),
        })
  return data
}

export function useAddStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: addStock,
    onSuccess: (material) => {
      queryClient.setQueryData<Material[]>(['materials'], (materials = []) => {
        const exists = materials.some((m) => m.id === material.id)
        return exists
          ? materials.map((m) => (m.id === material.id ? material : m))
          : [...materials, material]
      })
    },
  })
}
