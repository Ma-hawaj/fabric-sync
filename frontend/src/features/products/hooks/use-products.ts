import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Product } from '../types/product'

async function fetchProducts(): Promise<Product[]> {
  const response = await fetch(`${apiBaseUrl}/products`)
  if (!response.ok) {
    throw new Error(`Failed to load products (${response.status})`)
  }
  return response.json()
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
