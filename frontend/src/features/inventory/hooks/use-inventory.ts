import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Material } from '../types/inventory'

async function fetchMaterials(): Promise<Material[]> {
  const response = await fetch(`${apiBaseUrl}/materials`)
  if (!response.ok) {
    throw new Error(`Failed to load materials (${response.status})`)
  }
  return response.json()
}

export function useInventory() {
  return useQuery({
    queryKey: ['materials'],
    queryFn: fetchMaterials,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
