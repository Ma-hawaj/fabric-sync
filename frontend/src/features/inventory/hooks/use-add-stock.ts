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
  const entries = entriesPayload(values)

  if (values.mode === 'existing') {
    const response = await apiClient.post<Material>(
      `/materials/${values.materialId}/stock`,
      { entries },
    )

    return response.data
  }

  const response = await apiClient.post<Material>('/materials', {
    name: values.name,
    sku: values.sku.trim() || null,
    unit: values.unit,
    entries,
  })

  return response.data
}

export function useAddStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: addStock,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['materials'] })
    },
  })
}
