import { useRef } from 'react'
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
  requestId,
}: RecordPaymentInput & { requestId: string }): Promise<RecordedPayment> {
  const { data } = await apiClient.post<RecordedPayment>(
    `/invoices/${invoiceId}/payments`,
    { requestId, amount, paymentType, orderId: orderId ?? null },
  )
  return data
}

// A till payment: money taken without collecting anything — an extra advance
// now, or the remainder after everything was already collected.
export function useRecordPayment() {
  const queryClient = useQueryClient()
  // One intended payment per mounted dialog, including edited retries.
  const requestId = useRef<string | null>(null)

  return useMutation({
    mutationFn: (input: RecordPaymentInput) => {
      requestId.current ??= crypto.randomUUID()
      return recordPayment({ ...input, requestId: requestId.current })
    },
    // A lost response may follow a committed payment. Refresh on failure too.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ])
    },
  })
}
