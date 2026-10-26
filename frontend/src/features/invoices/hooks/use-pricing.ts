import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { UrgentChargeRule } from '../lib/garment-pricing'

export function usePricing() {
  return useQuery({
    queryKey: ['pricing'],
    queryFn: async () =>
      (
        await apiClient.get<{
          vatRate: number
          urgentCharge: UrgentChargeRule | null
          customerMaterialBasePrice: number | null
        }>('/pricing')
      ).data,
    staleTime: 5 * 60 * 1000,
  })
}
