export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentType = 'benefit' | 'cash' | 'card'

export interface InvoiceCustomer {
  name: string
  mobileNo: string
}

// Shape of GET /invoices — one row per invoice, with its customers and
// material names aggregated. An invoice is settled through any number of
// payments (the ledger); `amountPaid` is their sum and `paymentMethod` the
// most recent one's method.
export interface Invoice {
  id: string
  date: string
  customers: InvoiceCustomer[]
  itemCount: number
  materials: string[]
  totalPrice: number
  paymentStatus: PaymentStatus
  amountPaid: number
  balanceDue: number
  paymentMethod: PaymentType | null
  giftCardRedeemed: number
}
