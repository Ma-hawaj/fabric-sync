import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type {
  AudienceCount,
  AudienceFilter,
  Campaign,
  CampaignPreview,
  Capabilities,
  MarketingTemplate,
  RecipientPage,
  ConsentResponse,
} from './types'

const staleTime = 5 * 60 * 1000
export function useCampaigns(search: URLSearchParams) {
  return useQuery({
    queryKey: ['campaigns', search.toString()],
    queryFn: async () =>
      (
        await apiClient.get<{ items: Campaign[]; total: number }>(
          `/campaigns?${search}`,
        )
      ).data,
    staleTime,
    refetchInterval: 10000,
  })
}
export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: async () =>
      (await apiClient.get<Campaign>(`/campaigns/${id}`)).data,
    enabled: Boolean(id),
    staleTime,
    refetchInterval: (query) =>
      ['scheduled', 'sending', 'blocked'].includes(
        query.state.data?.state ?? '',
      )
        ? 5000
        : false,
  })
}
export function useMarketingTemplates() {
  return useQuery({
    queryKey: ['campaign-templates'],
    queryFn: async () =>
      (await apiClient.get<MarketingTemplate[]>('/campaign-templates')).data,
    staleTime,
    refetchInterval: (query) =>
      query.state.data?.some((t) => ['pending', 'submitting'].includes(t.state))
        ? 15000
        : false,
  })
}
export function useCampaignCapabilities() {
  return useQuery({
    queryKey: ['campaign-capabilities'],
    queryFn: async () =>
      (await apiClient.get<Capabilities>('/campaigns/capabilities')).data,
    staleTime,
  })
}
export function useCampaignRecipients(
  id: string,
  page: number,
  active: boolean,
) {
  return useQuery({
    queryKey: ['campaign-recipients', id, page],
    queryFn: async () =>
      (
        await apiClient.get<RecipientPage>(`/campaigns/${id}/recipients`, {
          params: { page, perPage: 50 },
        })
      ).data,
    staleTime,
    // Provider receipts can arrive after the queue has completed.
    refetchInterval: (query) =>
      active ||
      ['accepted', 'delivered'].some(
        (state) => (query.state.data?.counts[state] ?? 0) > 0,
      )
        ? 5000
        : false,
  })
}
export function useMarketingConsent(id: string) {
  return useQuery({
    queryKey: ['marketing-consent', id],
    queryFn: async () =>
      (
        await apiClient.get<ConsentResponse>(
          `/customers/${id}/marketing-consent`,
        )
      ).data,
    staleTime,
  })
}
export function useCampaignMutation<T = Campaign>() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      path,
      body,
      method = 'post',
    }: {
      path: string
      body?: unknown
      method?: 'post' | 'patch' | 'put'
    }) => (await apiClient[method]<T>(path, body)).data,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['campaigns'] }),
        client.invalidateQueries({ queryKey: ['campaign-templates'] }),
        client.invalidateQueries({ queryKey: ['campaign-recipients'] }),
        client.invalidateQueries({ queryKey: ['marketing-consent'] }),
        client.invalidateQueries({ queryKey: ['campaign-audience-count'] }),
      ])
    },
  })
}
export type { CampaignPreview }

export function useCampaignAudienceCount(filter: AudienceFilter | null) {
  const serialized = JSON.stringify(filter)
  const [debounced, setDebounced] = useState(serialized)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(serialized), 300)
    return () => clearTimeout(timer)
  }, [serialized])
  const query = useQuery({
    queryKey: ['campaign-audience-count', debounced],
    queryFn: async ({ signal }) =>
      (
        await apiClient.post<AudienceCount>(
          '/campaigns/audience-count',
          JSON.parse(debounced) as AudienceFilter,
          { signal },
        )
      ).data,
    enabled: debounced !== 'null',
    staleTime: 0,
    retry: false,
  })
  return { ...query, isUpdating: serialized !== debounced }
}
