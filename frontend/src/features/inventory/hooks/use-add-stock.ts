import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Material, MaterialLocationStock } from '../types/inventory'
import type { InventoryFormValues } from '../types/inventory-form'

function toStock(values: InventoryFormValues): MaterialLocationStock[] {
  return values.entries.map((entry) => ({
    location: entry.location,
    quantity: entry.quantity === '' ? 0 : entry.quantity,
  }))
}

function applyStock(
  locations: MaterialLocationStock[],
  additions: MaterialLocationStock[],
) {
  let next = locations
  for (const addition of additions) {
    const hasLocation = next.some((l) => l.location === addition.location)
    next = hasLocation
      ? next.map((l) =>
          l.location === addition.location
            ? { ...l, quantity: l.quantity + addition.quantity }
            : l,
        )
      : [...next, addition]
  }
  return next
}

export function useAddStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values: InventoryFormValues) => {
      // Mocked — no backend endpoint exists yet for materials/stock.
      await new Promise((resolve) => setTimeout(resolve, 300))
      return values
    },
    onSuccess: (values) => {
      const additions = toStock(values)

      queryClient.setQueryData<Material[]>(['inventory'], (materials = []) => {
        if (values.mode === 'existing') {
          return materials.map((material) =>
            material.id === values.materialId
              ? {
                  ...material,
                  locations: applyStock(material.locations, additions),
                }
              : material,
          )
        }

        const newMaterial: Material = {
          id: crypto.randomUUID(),
          name: values.name,
          sku: values.sku,
          unit: values.unit,
          locations: additions,
        }
        return [...materials, newMaterial]
      })
    },
  })
}
