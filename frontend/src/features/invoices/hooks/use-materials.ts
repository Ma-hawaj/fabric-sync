import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Material } from '../types/materials'

async function fetchMaterials(): Promise<Material[]> {
  const { data } = await apiClient.get<Material[]>('/materials')
  return data
}

export function useMaterials() {
  return useQuery({
    queryKey: ['materials'],
    queryFn: fetchMaterials,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
