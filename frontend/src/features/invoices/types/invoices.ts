export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

export interface InvoiceCustomer {
  name: string
  mobileNo: string
}

// Shape of GET /invoices — one row per invoice, with its customers and
// material names aggregated.
export interface Invoice {
  id: string
  date: string
  customers: InvoiceCustomer[]
  itemCount: number
  materials: string[]
  totalPrice: number
  paymentStatus: PaymentStatus
}
