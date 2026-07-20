export type OrderStatus = 'pending' | 'received'
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid'

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
}
