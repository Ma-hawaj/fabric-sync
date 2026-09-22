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
  const response = await apiClient.patch<Location>(`/locations/${id}`, changes)

  return response.data
}

export function useUpdateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateLocation,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })
}
