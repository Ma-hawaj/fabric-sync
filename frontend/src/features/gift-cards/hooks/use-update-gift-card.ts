import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

// Recipient details and active status are editable. Balance changes through redemption.
export interface UpdateGiftCardInput {
  id: string
  isActive?: boolean
  boughtFor?: string
  recipientPhone?: string
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
