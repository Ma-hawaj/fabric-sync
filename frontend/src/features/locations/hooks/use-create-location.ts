import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { LocationFormValues } from '../types/location-form'
import type { Location } from '../types/location'

async function createLocation(values: LocationFormValues): Promise<Location> {
  const { data } = await apiClient.post<Location>('/locations', {
    name: values.name,
    receivesOrders: values.receivesOrders,
    holdsStock: values.holdsStock,
  })
  return data
}

export function useCreateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createLocation,
    onSuccess: (location) => {
      // Patching the cache rather than invalidating keeps the inventory and
      // invoice pickers in step without a refetch.
      queryClient.setQueryData<Location[]>(['locations'], (locations = []) =>
        [...locations, location].sort((a, b) => a.name.localeCompare(b.name)),
      )
    },
  })
}
