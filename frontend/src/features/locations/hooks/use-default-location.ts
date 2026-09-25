import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import {
  orderReceivingLocations,
  stockLocations,
} from '../lib/location-filters'
import type { Location } from '../types/location'

/** Shape of GET/PUT /me/preferences — one row per user, nulls until set. */
export interface Preferences {
  defaultLocationId: string | null
  defaultLocation: Location | null
}

async function fetchPreferences(): Promise<Preferences> {
  const { data } = await apiClient.get<Preferences>('/me/preferences')
  return data
}

async function saveDefaultLocation(
  defaultLocationId: string | null,
): Promise<Preferences> {
  const { data } = await apiClient.put<Preferences>('/me/preferences', {
    defaultLocationId,
  })
  return data
}

export function usePreferences() {
  return useQuery({
    queryKey: ['default-location'],
    queryFn: fetchPreferences,
    staleTime: 1000 * 60 * 5,
  })
}

/** The stored default location id, or null when unset/still loading. */
export function useDefaultLocationId(): string | null {
  const { data } = usePreferences()
  return data?.defaultLocationId ?? null
}

export type DefaultLocationKind = 'receiving' | 'stock'

/**
 * The default location when it is usable as this kind of picker, else null.
 * Capability rules stay in `lib/location-filters` — this just runs the stored
 * default through them, so a branch-only default never lands in a stock
 * picker and a deactivated one lands nowhere.
 */
export function useApplicableDefaultLocation(
  kind: DefaultLocationKind,
): Location | null {
  const { data } = usePreferences()
  const location = data?.defaultLocation
  if (!location) {
    return null
  }
  const applicable =
    kind === 'receiving'
      ? orderReceivingLocations([location])
      : stockLocations([location])
  return applicable.length > 0 ? location : null
}

export function useSetDefaultLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveDefaultLocation,
    onSuccess: (preferences) => {
      // The endpoint returns the saved row (location joined in), so patch
      // the cache rather than invalidating.
      queryClient.setQueryData(['default-location'], preferences)
    },
  })
}
