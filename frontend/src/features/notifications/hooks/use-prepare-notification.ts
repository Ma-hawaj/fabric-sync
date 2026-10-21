import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { NotificationDraft, NotificationKind } from '../types'

interface PrepareNotificationInput {
  invoiceId: string
  kind: NotificationKind
  requestId: string
  resendOf?: string
}

async function prepareNotification({
  invoiceId,
  ...body
}: PrepareNotificationInput) {
  return (
    await apiClient.post<NotificationDraft>(
      `/invoices/${invoiceId}/notifications`,
      body,
    )
  ).data
}

export function usePrepareNotification(
  onPrepared: (draft: NotificationDraft) => void,
) {
  return useMutation({ mutationFn: prepareNotification, onSuccess: onPrepared })
}
