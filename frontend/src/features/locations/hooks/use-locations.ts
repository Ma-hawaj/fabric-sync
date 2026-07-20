import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Location } from '../types/location'

async function fetchLocations(): Promise<Location[]> {
  const response = await fetch(`${apiBaseUrl}/locations`)
  if (!response.ok) {
    throw new Error(`Failed to load locations (${response.status})`)
  }
  return response.json()
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
