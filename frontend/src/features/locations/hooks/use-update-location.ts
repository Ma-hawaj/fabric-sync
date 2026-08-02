import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Location } from '../types/location'

// PATCH accepts any subset of the fields, so this serves both the edit form
// (which sends all of them) and the list page's activate/deactivate action
// (which sends only `isActive`).
export interface UpdateLocationInput {
  id: string
  name?: string
  receivesOrders?: boolean
  holdsStock?: boolean
  isActive?: boolean
}

async function updateLocation({
  id,
  ...changes
}: UpdateLocationInput): Promise<Location> {
  const { data } = await apiClient.patch<Location>(`/locations/${id}`, changes)
  return data
}

export function useUpdateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateLocation,
    onSuccess: (location) => {
      queryClient.setQueryData<Location[]>(['locations'], (locations = []) =>
        locations
          .map((existing) =>
            existing.id === location.id ? location : existing,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    },
  })
}
