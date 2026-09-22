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
  const response = await apiClient.patch<Product>(`/products/${id}`, changes)
  const patched = response.data
  if (!entries?.length) return patched

  // Stock is added through its own endpoint, which also returns the full
  // product — so its response is the newer of the two.
  const stockResponse = await apiClient.post<Product>(`/products/${id}/stock`, {
    entries,
  })

  return stockResponse.data
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateProduct,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })
}
