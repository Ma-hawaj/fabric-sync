import type { QueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { ListResponse } from '@/hooks/use-list-query'

// The pieces the sibling check needs; the full order shape isn't fetched here.
interface InvoiceOrderRow {
  currentStage: string | null
  status: 'pending' | 'received'
}

/**
 * True once every order on an invoice is "ready": production complete (no
 * outstanding stage) or already received (collected — inherently finished).
 * The orders list is filtered server-side because the invoice may have orders
 * beyond whatever page the operator is looking at.
 */
export async function isInvoiceFullyReady(
  invoiceId: string,
  queryClient: QueryClient,
): Promise<boolean> {
  const search = new URLSearchParams()
  search.set(
    'filters',
    JSON.stringify([
      { id: 'invoiceId', value: invoiceId, variant: 'text', operator: 'eq' },
    ]),
  )
  const query = search.toString()

  const { data } = await queryClient.fetchQuery({
    queryKey: ['orders', query],
    queryFn: async () => {
      const response = await apiClient.get<ListResponse<InvoiceOrderRow>>(
        `/orders?${query}`,
      )
      return response.data
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  return data.every(
    (order) => order.currentStage === null || order.status === 'received',
  )
}
