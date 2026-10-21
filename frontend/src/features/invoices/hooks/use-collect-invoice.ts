import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { PaymentType } from '../types/invoices'

interface CollectInvoiceInput {
  invoiceId: string
  /** Omitted when nothing is left to pay — collecting a paid invoice takes no money. */
  paymentType: PaymentType | null
}

interface CollectedInvoice {
  id: string
  paymentStatus: string
  amountPaid: number
  balanceDue: number
  paymentMethod: PaymentType | null
  collected: boolean
}

async function collectInvoice({
  invoiceId,
  paymentType,
}: CollectInvoiceInput): Promise<CollectedInvoice> {
  const { data } = await apiClient.post<CollectedInvoice>(
    `/invoices/${invoiceId}/collect`,
    { paymentType },
  )
  return data
}

export function useCollectInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: collectInvoice,
    onSuccess: () => {
      // Settles every order on the invoice at once, so both lists are stale.
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
