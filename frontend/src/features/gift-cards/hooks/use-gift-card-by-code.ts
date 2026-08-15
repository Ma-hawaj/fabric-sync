import { useQuery } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

// A miss is a normal answer here — staff mistype codes — so it comes back as
// `null` data rather than a thrown error the caller has to unpack.
async function fetchGiftCardByCode(code: string): Promise<GiftCard | null> {
  try {
    const { data } = await apiClient.get<GiftCard>(
      `/gift-cards/by-code/${encodeURIComponent(code)}`,
    )
    return data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/**
 * Resolves a single card from a code someone typed. Unlike every other query
 * hook here the key is parameterized, because the point is *not* to hold the
 * whole list client-side: a card can only be spent by someone who knows its
 * code, which means the customer has to present it.
 */
export function useGiftCardByCode(code: string) {
  return useQuery({
    queryKey: ['gift-card', code],
    queryFn: () => fetchGiftCardByCode(code),
    enabled: code.length > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
