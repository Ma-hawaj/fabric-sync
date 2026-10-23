import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { NotificationDraft } from '../types'

export function useNotificationDelivery(id: string, open: boolean) {
  return useQuery({
    queryKey: ['notification-delivery', id],
    queryFn: async () =>
      (await apiClient.get<NotificationDraft>(`/notifications/${id}`)).data,
    enabled: open,
    staleTime: 5000,
    refetchInterval: open ? 10000 : false,
  })
}
