import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { LocationFormValues } from '../types/location-form'
import type { Location } from '../types/location'

async function createLocation(values: LocationFormValues): Promise<Location> {
  const response = await apiClient.post<Location>('/locations', {
    name: values.name,
    receivesOrders: values.receivesOrders,
    holdsStock: values.holdsStock,
  })

  return response.data
}

export function useCreateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createLocation,
    onSuccess: () => {
      // Patching the cache rather than invalidating keeps the inventory and
      // invoice pickers in step without a refetch.
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })
}
