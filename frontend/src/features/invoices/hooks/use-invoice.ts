import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { InvoiceDetail } from '../types/invoice-detail'

async function fetchInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.get<InvoiceDetail>(`/invoices/${invoiceId}`)
  return data
}

/**
 * One invoice with its line items. `['invoices']` is the list; this keys off
 * `['invoices', id]` beneath it, because the list rows carry only aggregates
 * (a count, the material names) and never the lines themselves — there is
 * nothing to filter the detail out of client-side.
 *
 * Pass `null` to hold the query until an invoice is selected.
 */
export function useInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => fetchInvoice(invoiceId as string),
    enabled: invoiceId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
