import { useQuery } from '@tanstack/react-query'

const MOCK_LOCATIONS = ['Main Warehouse', 'Downtown Branch', 'Airport Branch']

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      // Mocked — no backend endpoint exists yet for storage locations.
      await new Promise((resolve) => setTimeout(resolve, 500))
      return MOCK_LOCATIONS
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
