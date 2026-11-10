import { useQuery } from '@tanstack/react-query'
import { useListQuery } from '@/hooks/use-list-query'
import { useAuth } from '@/lib/auth'
import { canAccess } from '@/lib/permissions'
import { apiClient } from '@/lib/api'
import type {
  NotificationAttentionRow,
  NotificationAttentionSummary,
} from '../types'

export function useNotificationAttention(searchParams: URLSearchParams) {
  return useListQuery<NotificationAttentionRow>({
    endpoint: '/notifications',
    queryKey: 'notification-attention',
    searchParams,
    refetchInterval: 30000,
  })
}

export function useNotificationAttentionSummary() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['notification-attention-summary'],
    queryFn: async () =>
      (
        await apiClient.get<NotificationAttentionSummary>(
          '/notifications/summary',
        )
      ).data,
    enabled: canAccess(user, 'GET', '/notifications/summary'),
    staleTime: 10000,
    refetchInterval: 30000,
  })
}
