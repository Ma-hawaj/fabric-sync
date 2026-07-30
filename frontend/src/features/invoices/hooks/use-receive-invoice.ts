import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import type { PaymentType } from '../types/invoices'

interface ReceiveInvoiceInput {
  invoiceId: string
  paymentType: PaymentType
}

interface ReceivedInvoice {
  id: string
  paymentStatus: string
  amountPaid: number
  finalPaymentType: PaymentType | null
}

async function receiveInvoice({
  invoiceId,
  paymentType,
}: ReceiveInvoiceInput): Promise<ReceivedInvoice> {
  const response = await fetch(`${apiBaseUrl}/invoices/${invoiceId}/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentType }),
  })
  if (!response.ok) {
    throw new ApiError(
      `Failed to receive invoice (${response.status})`,
      response.status,
    )
  }
  return response.json()
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
