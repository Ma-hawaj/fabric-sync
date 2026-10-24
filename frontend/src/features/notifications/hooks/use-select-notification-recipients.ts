import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { NotificationDraft, NotificationSelectionInput } from '../types'

async function selectRecipients({ id, ...body }: NotificationSelectionInput) {
  return (
    await apiClient.post<NotificationDraft>(
      `/notifications/${id}/selection`,
      body,
    )
  ).data
}

export function useSelectNotificationRecipients() {
  return useMutation({ mutationFn: selectRecipients })
}
