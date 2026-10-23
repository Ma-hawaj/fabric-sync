import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { NotificationHistoryRow } from '../types'

export function useNotificationSends(id: string, open: boolean) {
  return useQuery({
    queryKey: ['notification-sends', id],
    queryFn: async () =>
      (
        await apiClient.get<NotificationHistoryRow[]>(
          `/notifications/${id}/sends`,
        )
      ).data,
    enabled: open,
    staleTime: 5000,
    refetchInterval: open ? 10000 : false,
  })
}
