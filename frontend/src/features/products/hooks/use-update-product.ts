import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { apiBaseUrl } from '@/lib/api'
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
  const response = await fetch(`${apiBaseUrl}/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to update product (${response.status})`,
      response.status,
    )
  }

  const patched: Product = await response.json()
  if (!entries?.length) return patched

  // Stock is added through its own endpoint, which also returns the full
  // product — so its response is the newer of the two.
  const stockResponse = await fetch(`${apiBaseUrl}/products/${id}/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
  if (!stockResponse.ok) {
    throw new ApiError(
      `Failed to add stock (${stockResponse.status})`,
      stockResponse.status,
    )
  }
  return stockResponse.json()
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
