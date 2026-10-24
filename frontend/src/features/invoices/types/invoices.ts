import type { ReadinessFields } from '@/features/notifications/readiness-controls'

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentType = 'benefit' | 'cash' | 'card'

export interface InvoiceCustomer {
  name: string
  mobileNo: string
  address?: string | null
}

// Shape of GET /invoices — one row per invoice, with its customers and
// material names aggregated. An invoice is settled through any number of
// payments (the ledger). The invoice total stays at the original sale value;
// `netTotal` and tender account for credits and refunds separately.
export interface Invoice extends ReadinessFields {
  createdBy: string | null
  urgentCharge: number
  collectionMethod: 'delivery' | 'pickup'
  id: string
  invoiceNumber: number
  /** Server-set creation moment, as an ISO datetime with the time of day. */
  date: string
  /** The promised delivery date, editable on the form. Null when none was promised. */
  targetDate: string | null
  customers: InvoiceCustomer[]
  itemCount: number
  materials: string[]
  /** Original invoice value, preserved after returns and refunds. */
  totalPrice: number
  netTotal: number
  amountCredited: number
  amountRefunded: number
  refundDue: number
  paymentStatus: PaymentStatus
  amountPaid: number
  balanceDue: number
  paymentMethod: PaymentType | null
  giftCardRedeemed: number
  /** Goods receipt, separate from money: every order collected. */
  collected: boolean
  /** Tailoring garments only, excluding retail products and gift cards. */
  orderCount: number
  collectedOrderCount: number
  /**
   * Latest collection across the invoice's tailoring lines, as an ISO
   * datetime. Null until the first order is collected (and on retail-only
   * invoices, which have no orders).
   */
  lastCollectedAt: string | null
  /** Where the customer collects, taken from the invoice's branch. */
  receivingLocation: string | null
  /** Distinct production locations across the invoice's tailoring lines. */
  productionLocations: string[]
}
