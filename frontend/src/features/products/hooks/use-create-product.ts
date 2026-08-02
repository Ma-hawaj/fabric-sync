import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { stockEntriesPayload } from '../lib/product-payload'
import type { Product } from '../types/product'
import type { ProductFormValues } from '../types/product-form'

async function createProduct(values: ProductFormValues): Promise<Product> {
  const { data } = await apiClient.post<Product>('/products', {
    name: values.name,
    sku: values.sku.trim() || null,
    unitPrice: values.unitPrice === '' ? 0 : values.unitPrice,
    entries: stockEntriesPayload(values.entries),
  })
  return data
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createProduct,
    onSuccess: (product) => {
      // The endpoint returns the full product, so the cache can be patched
      // rather than refetched — the invoice form's picker reads the same key.
      queryClient.setQueryData<Product[]>(['products'], (products = []) =>
        [...products, product].sort((a, b) => a.name.localeCompare(b.name)),
      )
    },
  })
}
