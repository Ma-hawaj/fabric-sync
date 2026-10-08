import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Location } from '../types/location'

/**
 * The whole location list as id-and-name options, unpaginated — for pickers
 * that need every row without paging through the table endpoint. Narrow the
 * result with the helpers in `lib/location-filters` rather than reading the
 * capability flags inline.
 */
export function useLocationOptions() {
  return useQuery({
    queryKey: ['location-options'],
    queryFn: async (): Promise<Location[]> => {
      const { data } = await apiClient.get<Location[]>('/locations/options')
      return data
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
