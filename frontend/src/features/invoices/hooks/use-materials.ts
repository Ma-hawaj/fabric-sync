import { useListQuery } from '@/hooks/use-list-query'
import type { Material } from '../types/materials'

const ALL = new URLSearchParams()

/**
 * Every material, for the invoice form's picker. Shares the `materials` key
 * prefix with the inventory table's paginated hook but keeps its own cache
 * entry, so the two no longer overwrite each other's differently-shaped data.
 */
export function useMaterials() {
  return useListQuery<Material>({
    endpoint: '/materials',
    queryKey: 'materials',
    searchParams: ALL,
  })
}
