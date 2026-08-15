import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Product } from '../types/product'

// PATCH accepts any subset of the fields, so this serves both the edit form
// (which sends all of them) and the list page's activate/deactivate action
// (which sends only `isActive`). `entries` is not part of the PATCH body —
// adding stock is a separate, additive endpoint.
export interface UpdateProductInput {
  id: string
  name?: string
  sku?: string | null
  unitPrice?: number
  isActive?: boolean
  entries?: { locationId: string; quantity: number }[]
}

async function updateProduct({
  id,
  entries,
  ...changes
}: UpdateProductInput): Promise<Product> {
  const { data: patched } = await apiClient.patch<Product>(
    `/products/${id}`,
    changes,
  )
  if (!entries?.length) return patched

  // Stock is added through its own endpoint, which also returns the full
  // product — so its response is the newer of the two.
  const { data: withStock } = await apiClient.post<Product>(
    `/products/${id}/stock`,
    { entries },
  )
  return withStock
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateProduct,
    onSuccess: (product) => {
      queryClient.setQueryData<Product[]>(['products'], (products = []) =>
        products
          .map((existing) => (existing.id === product.id ? product : existing))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    },
  })
}
