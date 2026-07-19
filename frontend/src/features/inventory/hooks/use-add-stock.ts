import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
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
  const request =
    values.mode === 'existing'
      ? {
          url: `${apiBaseUrl}/materials/${values.materialId}/stock`,
          body: { entries: entriesPayload(values) },
        }
      : {
          url: `${apiBaseUrl}/materials`,
          body: {
            name: values.name,
            sku: values.sku.trim() || null,
            unit: values.unit,
            entries: entriesPayload(values),
          },
        }

  const response = await fetch(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to save stock (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
