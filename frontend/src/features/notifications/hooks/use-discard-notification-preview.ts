import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

async function discardPreview(id: string) {
  // Approval may have completed while the page was closing. The server only
  // deletes never-approved previews.
  await apiClient.delete(`/notifications/${id}`)
}

export function useDiscardNotificationPreview() {
  return useMutation({ mutationFn: discardPreview })
}
