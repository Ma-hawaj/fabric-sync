import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { NotificationHistoryRow } from '../types'

export function useNotificationHistory(invoiceId: string) {
  return useQuery({
    queryKey: ['notifications', invoiceId],
    queryFn: async () =>
      (
        await apiClient.get<NotificationHistoryRow[]>(
          `/invoices/${invoiceId}/notifications`,
        )
      ).data,
    staleTime: 5000,
    refetchInterval: 10000,
  })
}
