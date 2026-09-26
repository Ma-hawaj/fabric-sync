import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { PaymentType } from '../types/invoices'
import type { InvoicePayment } from '../types/invoice-detail'

interface RecordPaymentInput {
  invoiceId: string
  amount: number
  paymentType: PaymentType
  /** Attributes the payment to a pickup when taken at one. */
  orderId?: string | null
}

interface RecordedPayment {
  payment: InvoicePayment
  summary: {
    paymentStatus: string
    amountPaid: number
    balanceDue: number
  }
}

async function recordPayment({
  invoiceId,
  amount,
  paymentType,
  orderId,
}: RecordPaymentInput): Promise<RecordedPayment> {
  const { data } = await apiClient.post<RecordedPayment>(
    `/invoices/${invoiceId}/payments`,
    { amount, paymentType, orderId: orderId ?? null },
  )
  return data
}

// A till payment: money taken without collecting anything — an extra advance
// now, or the remainder after everything was already collected.
export function useRecordPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: recordPayment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
