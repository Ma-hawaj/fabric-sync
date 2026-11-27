import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { InvoiceFormValues } from '../types/invoice-form'
import { invoicePayload } from '../lib/invoice-payload'
import type { CreatedInvoice } from '../lib/invoice-payload'

async function createInvoice(
  values: InvoiceFormValues,
): Promise<CreatedInvoice> {
  const { data } = await apiClient.post<CreatedInvoice>(
    '/invoices',
    invoicePayload(values),
  )
  return data
}

export function useCreateInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createInvoice,
    onSuccess: () => {
      // Saving an invoice can create customers and always records new
      // measurement snapshots, so cached customers are stale now — as are
      // the invoice and order lists.
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      // The invoice form's customer picker carries its measurement history in
      // its own cached rows. Drop them so the next invoice form fetches the
      // customer afresh instead of pre-filling from the pre-save snapshot
      // while a background refetch is still in flight.
      void queryClient.removeQueries({ queryKey: ['invoice-customer'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      // A sale can draw down product stock, issue new cards, and spend the
      // balance on existing ones.
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
