import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { InvoiceHistoryEntry } from '../types/invoice-history'

async function fetchInvoiceHistory(
  invoiceId: string,
): Promise<InvoiceHistoryEntry[]> {
  const { data } = await apiClient.get<InvoiceHistoryEntry[]>(
    `/invoices/${invoiceId}/history`,
  )
  return data
}

/**
 * The invoice's chronological history: creation, field-level edits, and the
 * payment/collection/return/refund ledger events merged server-side.
 */
export function useInvoiceHistory(invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoices', invoiceId, 'history'],
    queryFn: () => fetchInvoiceHistory(invoiceId as string),
    enabled: invoiceId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
