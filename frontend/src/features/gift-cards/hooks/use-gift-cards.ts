import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

async function fetchGiftCards(): Promise<GiftCard[]> {
  const response = await fetch(`${apiBaseUrl}/gift-cards`)
  if (!response.ok) {
    throw new Error(`Failed to load gift cards (${response.status})`)
  }
  return response.json()
}

export function useGiftCards() {
  return useQuery({
    queryKey: ['gift-cards'],
    queryFn: fetchGiftCards,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
