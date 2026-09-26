import type { PaymentStatus, PaymentType } from './invoices'

export type InvoiceLineKind = 'order' | 'product' | 'gift_card'

export interface InvoiceParty {
  name: string
  mobileNo: string
}

/**
 * One line of the invoice. Tailoring orders and retail items are two different
 * tables on the backend but one list here — `kind` is what tells them apart.
 *
 * `quantity` is metres of material for an order and a unit count for a
 * product, which is what `unit` distinguishes. An order is priced as a whole
 * line rather than per metre, so its `unitPrice` and `lineTotal` are equal.
 */
export interface InvoiceLine {
  kind: InvoiceLineKind
  /** Only set for an `order` line — lets it link straight to that order's tracking. */
  orderId: string | null
  description: string
  /** The made-to-measure specification, already joined into one string. */
  detail: string | null
  /** Who the garment is for; an invoice can carry orders for several people. */
  customer: InvoiceParty | null
  quantity: number
  unit: string | null
  unitPrice: number
  lineTotal: number
  /** False only for gift card sales, which are outside the VAT base. */
  taxable: boolean
}

export interface InvoiceRedemption {
  code: string
  amount: number
}

/** The arithmetic behind the total, as the backend computed it. */
export interface InvoiceTotals {
  subtotal: number
  discount: number
  discountUnit: 'amount' | 'percent'
  discountAmount: number
  taxable: number
  vatRate: number
  vat: number
  giftCardSales: number
  total: number
  giftCardRedeemed: number
  amountPaid: number
  balanceDue: number
}

/** One row of the invoice's payments ledger, oldest first. */
export interface InvoicePayment {
  id: string
  amount: number
  /** Null only on legacy rows imported without a recorded method. */
  paymentType: PaymentType | null
  paidAt: string
  /** The pickup this was taken at, when it was taken at one. */
  orderId: string | null
}

/** Shape of GET /invoices/:id. */
export interface InvoiceDetail {
  id: string
  invoiceNumber: number
  date: string
  createdAt: string
  branchName: string | null
  /** Named directly only on a retail sale; a tailoring invoice leaves it null. */
  buyer: InvoiceParty | null
  paymentStatus: PaymentStatus
  /** The most recent payment's method, if anything has been paid. */
  paymentMethod: PaymentType | null
  lines: InvoiceLine[]
  redemptions: InvoiceRedemption[]
  payments: InvoicePayment[]
  totals: InvoiceTotals
}
