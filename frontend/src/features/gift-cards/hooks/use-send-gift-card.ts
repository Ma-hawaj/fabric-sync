import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

export function useSendGiftCard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string
      sourceHash: string
      requestId: string
    }) =>
      (await apiClient.post<{ state: string }>(`/gift-cards/${id}/send`, input))
        .data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['gift-cards'] })
    },
  })
}
