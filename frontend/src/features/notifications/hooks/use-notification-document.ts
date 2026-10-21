import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

export function useNotificationDocument(artifactId: string | null | undefined) {
  return useQuery({
    queryKey: ['notification-document', artifactId],
    queryFn: async () =>
      (
        await apiClient.get<Blob>(`/documents/${artifactId}/content`, {
          responseType: 'blob',
        })
      ).data,
    enabled: Boolean(artifactId),
    staleTime: Infinity,
    gcTime: 0,
  })
}
