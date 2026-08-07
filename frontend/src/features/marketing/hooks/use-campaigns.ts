import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Campaign } from '../types/campaign'

async function fetchCampaigns(): Promise<Campaign[]> {
  const { data } = await apiClient.get<Campaign[]>('/marketing-messages')
  return data
}

export function useCampaigns() {
  return useQuery({
    queryKey: ['marketing-campaigns'],
    queryFn: fetchCampaigns,
    staleTime: 1000 * 60 * 5,
  })
}
