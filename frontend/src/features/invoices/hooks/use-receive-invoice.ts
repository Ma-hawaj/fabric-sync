import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { PaymentType } from '../types/invoices'

interface ReceiveInvoiceInput {
  invoiceId: string
  /** Omitted when nothing is left to pay — collecting a paid invoice takes no money. */
  paymentType: PaymentType | null
}

interface ReceivedInvoice {
  id: string
  paymentStatus: string
  amountPaid: number
  balanceDue: number
  paymentMethod: PaymentType | null
}

async function receiveInvoice({
  invoiceId,
  paymentType,
}: ReceiveInvoiceInput): Promise<ReceivedInvoice> {
  const { data } = await apiClient.post<ReceivedInvoice>(
    `/invoices/${invoiceId}/receive`,
    { paymentType },
  )
  return data
}

export function useReceiveInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: receiveInvoice,
    onSuccess: () => {
      // Settles every order on the invoice at once, so both lists are stale.
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
