import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

async function fetchGiftCards(): Promise<GiftCard[]> {
  const { data } = await apiClient.get<GiftCard[]>('/gift-cards')
  return data
}

export function useGiftCards() {
  return useQuery({
    queryKey: ['gift-cards'],
    queryFn: fetchGiftCards,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
