import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Product } from '../types/product'

async function fetchProducts(): Promise<Product[]> {
  const { data } = await apiClient.get<Product[]>('/products')
  return data
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
