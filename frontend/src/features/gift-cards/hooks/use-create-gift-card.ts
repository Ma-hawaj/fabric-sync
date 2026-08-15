import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'
import type { GiftCardFormValues } from '../types/gift-card-form'

async function createGiftCard(values: GiftCardFormValues): Promise<GiftCard> {
  const { data } = await apiClient.post<GiftCard>('/gift-cards', {
    code: values.code,
    amount: values.amount === '' ? 0 : values.amount,
    customerId: values.customerId || null,
    expiresOn: values.expiresOn || null,
  })
  return data
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
