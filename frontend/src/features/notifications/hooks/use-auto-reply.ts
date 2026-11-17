import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type {
  AutoReplySettings,
  AutoReplyUpdate,
} from '../lib/auto-reply-schema'

const queryKey = ['whatsapp-auto-reply']

export function useAutoReply(open: boolean) {
  return useQuery({
    queryKey,
    queryFn: async () =>
      (await apiClient.get<AutoReplySettings>('/notifications/auto-reply'))
        .data,
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

export function useUpdateAutoReply() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: AutoReplyUpdate) =>
      (
        await apiClient.put<AutoReplySettings>(
          '/notifications/auto-reply',
          input,
        )
      ).data,
    onSuccess: (settings) => client.setQueryData(queryKey, settings),
  })
}
