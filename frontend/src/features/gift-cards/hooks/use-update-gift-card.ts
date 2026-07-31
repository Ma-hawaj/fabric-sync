import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { apiBaseUrl } from '@/lib/api'
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
  const response = await fetch(`${apiBaseUrl}/gift-cards/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to update gift card (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
