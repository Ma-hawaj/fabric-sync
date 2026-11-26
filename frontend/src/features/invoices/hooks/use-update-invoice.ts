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
 * lists as creation — an edit can create customers, append measurements, and
 * move stock and gift card balances around — plus this invoice's own detail
 * and edit caches.
 */
export function useUpdateInvoice(invoiceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: InvoiceFormValues) => updateInvoice(invoiceId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      // The invoice form's customer picker caches whole customer rows,
      // measurements included — drop them so the next form loads fresh ones.
      void queryClient.removeQueries({ queryKey: ['invoice-customer'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['materials'] })
      void queryClient.invalidateQueries({ queryKey: ['invoice-material'] })
      void queryClient.invalidateQueries({
        queryKey: ['invoice-order-material'],
      })
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
      void queryClient.invalidateQueries({
        queryKey: ['notification-attention'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['notification-attention-summary'],
      })
    },
  })
}
