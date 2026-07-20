export type OrderStatus = 'pending' | 'received'
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentType = 'benefit' | 'cash' | 'card'

// One row of GET /orders — an order line joined with its invoice, customer,
// and material. invoiceDate arrives as an ISO date string and is parsed to a
// Date in use-orders.ts for the table's date-range filter.
//
// An invoice is settled in up to two payments: an advance taken up front (at
// invoice creation) and a final payment that clears the remaining balance
// (when the order is received) — each may use a different payment method,
// hence the separate advance/final payment type fields.
export interface Order {
  id: string
  invoiceId: string
  invoiceDate: Date
  measurementId: string
  customerName: string
  customerMobile: string
  material: string
  materialAmount: number
  price: number
  status: OrderStatus
  invoiceTotalPrice: number
  invoiceAmountPaid: number
  invoicePaymentStatus: InvoicePaymentStatus
  invoiceAdvanceAmount: number
  invoiceAdvancePaymentType: PaymentType | null
  invoiceFinalPaymentType: PaymentType | null
}
