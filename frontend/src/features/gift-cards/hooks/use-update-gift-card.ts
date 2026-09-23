import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

// Voiding is the one edit that makes sense once a card is in a customer's
// hands — its balance changes only by being spent on an invoice.
export interface UpdateGiftCardInput {
  id: string
  isActive: boolean
}

async function updateGiftCard({
  id,
  ...changes
}: UpdateGiftCardInput): Promise<GiftCard> {
  const response = await apiClient.patch<GiftCard>(`/gift-cards/${id}`, changes)

  return response.data
}

export function useUpdateGiftCard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateGiftCard,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
    },
  })
}
