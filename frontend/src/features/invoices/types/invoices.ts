export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentType = 'benefit' | 'cash' | 'card'

export interface InvoiceCustomer {
  name: string
  mobileNo: string
}

// Shape of GET /invoices — one row per invoice, with its customers and
// material names aggregated. An invoice is settled in up to two payments —
// an advance taken at creation and a final payment when the order is
// received — each with its own payment method.
export interface Invoice {
  id: string
  date: string
  customers: InvoiceCustomer[]
  itemCount: number
  materials: string[]
  totalPrice: number
  paymentStatus: PaymentStatus
  amountPaid: number
  advanceAmount: number
  advancePaymentType: PaymentType | null
  finalPaymentType: PaymentType | null
}
