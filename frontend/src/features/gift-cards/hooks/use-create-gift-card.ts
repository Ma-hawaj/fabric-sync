import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { apiBaseUrl, apiFetch } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'
import type { GiftCardFormValues } from '../types/gift-card-form'

async function createGiftCard(values: GiftCardFormValues): Promise<GiftCard> {
  const response = await apiFetch(`${apiBaseUrl}/gift-cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: values.code,
      amount: values.amount === '' ? 0 : values.amount,
      customerId: values.customerId || null,
      expiresOn: values.expiresOn || null,
    }),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to create gift card (${response.status})`,
      response.status,
    )
  }
  return response.json()
}

export function useCreateGiftCard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createGiftCard,
    onSuccess: (giftCard) => {
      // Newest first, matching the backend's ORDER BY id DESC.
      queryClient.setQueryData<GiftCard[]>(['gift-cards'], (cards = []) => [
        giftCard,
        ...cards,
      ])
    },
  })
}
