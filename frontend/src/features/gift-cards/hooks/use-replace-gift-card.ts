import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

/** Transfer the server-locked remaining balance and refresh both old and new codes. */
export function useReplaceGiftCard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      expiresOn,
    }: {
      id: string
      expiresOn: string | null
    }) => {
      const response = await apiClient.post<GiftCard>(
        `/gift-cards/${id}/replace`,
        { expiresOn },
      )
      return response.data
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['gift-cards'] })
      void client.invalidateQueries({ queryKey: ['gift-card'] })
      void client.invalidateQueries({ queryKey: ['gift-card-preview'] })
    },
  })
}
