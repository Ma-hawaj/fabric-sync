import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { LOCATION_QUERY_KEYS } from '../lib/location-filters'
import type { LocationFormValues } from '../types/location-form'
import type { Location } from '../types/location'

async function createLocation(values: LocationFormValues): Promise<Location> {
  const response = await apiClient.post<Location>('/locations', {
    name: values.name,
    receivesOrders: values.receivesOrders,
    holdsStock: values.holdsStock,
    producesOrders: values.producesOrders,
  })

  return response.data
}

export function useCreateLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createLocation,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      for (const queryKey of LOCATION_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey: [queryKey] })
      }
    },
  })
}
