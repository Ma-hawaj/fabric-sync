import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

export interface GiftCardPreview {
  sourceHash: string
  mobile: string
  boughtFor: string | null
  body: string
  imageDataUrl: string
  imageFilename: string
  canSend: boolean
  unavailableReason: string | null
}

export function useGiftCardPreview(id: string) {
  return useQuery({
    queryKey: ['gift-card-preview', id],
    queryFn: async () =>
      (await apiClient.get<GiftCardPreview>(`/gift-cards/${id}/preview`)).data,
    staleTime: 0,
    retry: false,
  })
}
