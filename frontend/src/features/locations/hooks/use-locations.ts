import { useListQuery } from '@/hooks/use-list-query'
import type { Location } from '../types/location'

const ENDPOINT = '/locations'
const QUERY_KEY = 'locations'
const ALL = new URLSearchParams()

// Returns inactive locations too — the locations page lists them behind a
// status filter, and callers that need only usable ones narrow the result with
// the helpers in `lib/location-filters`.
export function useLocations(searchParams: URLSearchParams) {
  return useListQuery<Location>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams,
  })
}

/**
 * The whole list, unpaginated — the form pickers need every row to populate a
 * combobox. An empty request omits `perPage`, which is what tells the API not to
 * page. The key shares the `locations` prefix with the paginated hook, so one
 * invalidation refreshes both.
 */
export function useAllLocations() {
  return useListQuery<Location>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams: ALL,
  })
}
