import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { apiBaseUrl } from '@/lib/api'
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
  const response = await fetch(`${apiBaseUrl}/locations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to update location (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
