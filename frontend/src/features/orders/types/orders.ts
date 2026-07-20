export type OrderStatus = 'pending' | 'received'
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentType = 'benefit' | 'cash' | 'card'

// An invoice is settled in up to two payments: an advance taken up front (at
// invoice creation) and a final payment that clears the remaining balance
// (when the order is received) — each may use a different payment method,
// hence the separate advance/final payment type fields.
export interface Order {
  id: string
  invoiceId: string
  invoiceDate: string
  customerId: string
  customerName: string
  customerMobile: string
  measurementId: string
  materialName: string
  status: OrderStatus
  price: number
  invoiceTotalPrice: number
  invoiceAmountPaid: number
  invoicePaymentStatus: InvoicePaymentStatus
  invoiceAdvanceAmount: number
  invoiceAdvancePaymentType: PaymentType | null
  invoiceFinalPaymentType: PaymentType | null
}
