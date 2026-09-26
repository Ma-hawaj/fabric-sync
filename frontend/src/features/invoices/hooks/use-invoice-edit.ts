import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { InvoiceEdit } from '../types/invoice-edit'

async function fetchInvoiceEdit(invoiceId: string): Promise<InvoiceEdit> {
  const { data } = await apiClient.get<InvoiceEdit>(
    `/invoices/${invoiceId}/edit`,
  )
  return data
}

/**
 * One invoice as it was entered, for the edit form. Keyed beneath
 * `['invoices', id]` like the display detail — it carries the ids the
 * display shape drops (materials, customers, measurements, branches).
 */
export function useInvoiceEdit(invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoices', invoiceId, 'edit'],
    queryFn: () => fetchInvoiceEdit(invoiceId as string),
    enabled: invoiceId !== null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
