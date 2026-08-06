import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Campaign } from '../types/campaign'

export interface CreateCampaignInput {
  body: string
  recipientCustomerIds: string[]
}

async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const { data } = await apiClient.post<Campaign>('/marketing-messages', input)
  return data
}

export function useCreateCampaign() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createCampaign,
    onSuccess: (campaign) => {
      queryClient.setQueryData<Campaign[]>(
        ['marketing-campaigns'],
        (campaigns = []) => [campaign, ...campaigns],
      )
    },
  })
}
