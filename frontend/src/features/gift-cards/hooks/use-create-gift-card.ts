import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'
import type { GiftCardFormValues } from '../types/gift-card-form'

async function createGiftCard(values: GiftCardFormValues): Promise<GiftCard> {
  const response = await apiClient.post<GiftCard>('/gift-cards', {
    code: values.code,
    amount: values.amount === '' ? 0 : values.amount,
    customerId: values.customerId || null,
    expiresOn: values.expiresOn || null,
  })

  return response.data
}

export function useCreateGiftCard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createGiftCard,
    onSuccess: () => {
      // Newest first, matching the backend's ORDER BY id DESC.
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
    },
  })
}
