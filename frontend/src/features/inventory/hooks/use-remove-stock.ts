import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Material } from '../types/inventory'

interface RemoveStockEntry {
  locationId: string
  quantity: number
}

interface RemoveStockInput {
  materialId: string
  entries: RemoveStockEntry[]
}

// Takes stock off without deleting the material — wastage, samples, or a
// correction. The backend guards every entry against the location's live
// quantity, so removing more than it holds is refused.
async function removeStock({
  materialId,
  entries,
}: RemoveStockInput): Promise<Material> {
  const { data } = await apiClient.post<Material>(
    `/materials/${materialId}/stock/remove`,
    { entries },
  )
  return data
}

export function useRemoveStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: removeStock,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['materials'] })
    },
  })
}
