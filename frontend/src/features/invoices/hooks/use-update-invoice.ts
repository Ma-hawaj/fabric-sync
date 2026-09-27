import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { InvoiceFormValues } from '../types/invoice-form'
import { invoicePayload } from '../lib/invoice-payload'
import type { CreatedInvoice } from '../lib/invoice-payload'

async function updateInvoice(
  invoiceId: string,
  values: InvoiceFormValues,
): Promise<CreatedInvoice> {
  const { data } = await apiClient.put<CreatedInvoice>(
    `/invoices/${invoiceId}`,
    invoicePayload(values),
  )
  return data
}

/**
 * A full rebuild from a fresh copy of the create input. Invalidates the same
 * lists as creation — an edit can create customers, rewrite measurements, and
 * move stock and gift card balances around — plus this invoice's own detail
 * and edit caches.
 */
export function useUpdateInvoice(invoiceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: InvoiceFormValues) => updateInvoice(invoiceId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
    },
  })
}
