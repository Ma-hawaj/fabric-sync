import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

/** One row of `GET /materials/options` — the minimal shape a picker needs. */
export interface MaterialOption {
  id: string
  name: string
  sku: string | null
  unit: string
}

export function materialOptionLabel(material: MaterialOption): string {
  return material.sku ? `${material.name} (${material.sku})` : material.name
}

/**
 * The whole material list as id-and-name options, unpaginated — for pickers
 * that need every row without paging through the table endpoint.
 */
export function useMaterialOptions() {
  return useQuery({
    queryKey: ['material-options'],
    queryFn: async (): Promise<MaterialOption[]> => {
      const { data } =
        await apiClient.get<MaterialOption[]>('/materials/options')
      return data
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
