import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { apiBaseUrl } from '@/lib/api'
import { stockEntriesPayload } from '../lib/product-payload'
import type { Product } from '../types/product'
import type { ProductFormValues } from '../types/product-form'

async function createProduct(values: ProductFormValues): Promise<Product> {
  const response = await fetch(`${apiBaseUrl}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: values.name,
      sku: values.sku.trim() || null,
      unitPrice: values.unitPrice === '' ? 0 : values.unitPrice,
      entries: stockEntriesPayload(values.entries),
    }),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to create product (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      // The endpoint returns the full product, so the cache can be patched
      // rather than refetched — the invoice form's picker reads the same key.
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })
}
