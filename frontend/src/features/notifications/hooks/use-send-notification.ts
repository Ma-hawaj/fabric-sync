import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { NotificationDraft, NotificationSelectionInput } from '../types'

interface SendNotificationInput extends NotificationSelectionInput {
  invoiceId: string
}

async function sendNotification({
  invoiceId: _invoiceId,
  id,
  ...body
}: SendNotificationInput) {
  return (
    await apiClient.post<NotificationDraft>(`/notifications/${id}/send`, body)
  ).data
}

export function useSendNotification() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: sendNotification,
    onSuccess: (_result, input) => {
      void client.invalidateQueries({
        queryKey: ['notifications', input.invoiceId],
      })
      void client.invalidateQueries({ queryKey: ['notification-sends'] })
    },
  })
}
