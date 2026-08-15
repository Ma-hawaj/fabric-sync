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
  const { data } = await apiClient.patch<GiftCard>(`/gift-cards/${id}`, changes)
  return data
}

export function useUpdateGiftCard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateGiftCard,
    onSuccess: (giftCard) => {
      queryClient.setQueryData<GiftCard[]>(['gift-cards'], (cards = []) =>
        cards.map((existing) =>
          existing.id === giftCard.id ? giftCard : existing,
        ),
      )
    },
  })
}
