import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { FinancialBranch } from '../types/invoice-detail'

export function useAssignFinancialBranch(invoiceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      requestId: string
      branchId: string
      reason: string
    }) => {
      const { data } = await apiClient.post<FinancialBranch>(
        `/invoices/${invoiceId}/financial-branch`,
        input,
      )
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['invoices'] }),
        client.invalidateQueries({ queryKey: ['sales-closing'] }),
        client.invalidateQueries({ queryKey: ['branch-day-status'] }),
      ])
    },
  })
}
