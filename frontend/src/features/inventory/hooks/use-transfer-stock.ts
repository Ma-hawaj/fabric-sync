import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Material } from '../types/inventory'

export interface TransferStockInput {
  materialId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
}

export function useTransferStock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ materialId, ...input }: TransferStockInput) =>
      (
        await apiClient.post<Material>(
          `/materials/${materialId}/stock/transfer`,
          input,
        )
      ).data,
    onSuccess: () => {
      // Moving stock also changes which production location can be inferred.
      for (const key of ['materials', 'invoice-order-material', 'orders'])
        void queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
}
