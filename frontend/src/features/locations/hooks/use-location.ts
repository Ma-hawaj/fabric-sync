import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Location } from '../types/location'

async function fetchLocation(locationId: string): Promise<Location> {
  const { data } = await apiClient.get<Location>(`/locations/${locationId}`)
  return data
}

/**
 * One location. `['locations']` is the list; this keys off
 * `['locations', id]` beneath it — a prefix of the list key, so the same
 * `invalidateQueries({ queryKey: ['locations'] })` mutations already do also
 * refetch this page with no extra wiring.
 *
 * Pass `null` to hold the query until an id is known (the "new" forms).
 */
export function useLocation(locationId: string | null) {
  return useQuery({
    queryKey: ['locations', locationId],
    queryFn: () => fetchLocation(locationId as string),
    enabled: locationId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
