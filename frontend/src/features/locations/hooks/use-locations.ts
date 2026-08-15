import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Location } from '../types/location'

async function fetchLocations(): Promise<Location[]> {
  const { data } = await apiClient.get<Location[]>('/locations')
  return data
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
