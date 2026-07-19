import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Material } from '../types/inventory'
import type { InventoryFormValues } from '../types/inventory-form'

export function useAddStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values: InventoryFormValues) => {
      // Mocked — no backend endpoint exists yet for materials/stock.
      await new Promise((resolve) => setTimeout(resolve, 300))
      return values
    },
    onSuccess: (values) => {
      const quantity = values.quantity === '' ? 0 : values.quantity

      queryClient.setQueryData<Material[]>(['inventory'], (materials = []) => {
        if (values.mode === 'existing') {
          return materials.map((material) => {
            if (material.id !== values.materialId) return material

            const hasLocation = material.locations.some(
              (l) => l.location === values.location,
            )
            const locations = hasLocation
              ? material.locations.map((l) =>
                  l.location === values.location
                    ? { ...l, quantity: l.quantity + quantity }
                    : l,
                )
              : [...material.locations, { location: values.location, quantity }]

            return { ...material, locations }
          })
        }

        const newMaterial: Material = {
          id: crypto.randomUUID(),
          name: values.name,
          sku: values.sku,
          unit: values.unit,
          locations: [{ location: values.location, quantity }],
        }
        return [...materials, newMaterial]
      })
    },
  })
}
