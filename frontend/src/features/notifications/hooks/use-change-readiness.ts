import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

type ChangeReadinessInput = {
  id: string
} & (
  | {
      scope: 'orders' | 'invoices'
      action: 'ready'
      body: { confirmedAtPickupBranch: boolean }
    }
  | { scope: 'orders'; action: 'reopen'; body: { reason: string } }
)

async function changeReadiness({
  id,
  scope,
  action,
  body,
}: ChangeReadinessInput) {
  return (
    await apiClient.post<{ becameReady?: boolean }>(
      `/${scope}/${id}/${action}`,
      body,
    )
  ).data
}

export function useChangeReadiness() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: changeReadiness,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
      void client.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}
