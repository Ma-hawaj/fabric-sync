import { useListQuery } from '@/hooks/use-list-query'
import type { GiftCard } from '../types/gift-card'

export function useGiftCards(searchParams: URLSearchParams) {
  return useListQuery<GiftCard>({
    endpoint: '/gift-cards',
    queryKey: 'gift-cards',
    searchParams,
  })
}
