import type { DiscountUnit } from './invoice-form'
import type { PaymentStatus, PaymentType } from './invoices'

/** Backend measurement fields as serialized camelCase (numbers stay null). */
export interface InvoiceEditMeasurement {
  date: string
  lengthFl: number | null
  lengthBl: number | null
  chest: number | null
  waist: number | null
  hips: number | null
  shoulder: number | null
  sleeveLength: number | null
  neck: number | null
  openHand: number | null
  chestUp: number | null
  cuffWidth: number | null
  neckWidth: number | null
  aramHole: number | null
  foWidth: number | null
  frantPocketLength: number | null
  farntPocketLengthByWidth: string | null
  sidePocket: string | null
  mobilePocketLengthByWidth: string | null
}

export interface InvoiceEditOrder {
  materialId: string
  materialName: string
  materialUnit: string
  materialAmount: number
  productionLocationId: string | null
  productionLocationName: string | null
  /** Live stock at the production location — seeds the "Made At" picker. */
  stockQuantity: number | null
  price: number
  thobeType: string | null
  fPocket: string | null
  collar: string | null
  sleeve: string | null
  patti: string | null
  moreDetails: string | null
}

export interface InvoiceEditCustomer {
  existingCustomerId: string
  customerName: string
  customerMobileNo: string
  /** The row an edit rewrites in place. */
  measurementId: string | null
  measurement: InvoiceEditMeasurement
  orders: InvoiceEditOrder[]
}

export interface InvoiceEditProductLine {
  productId: string | null
  productName: string
  quantity: number
  unitPrice: number
  branchId: string | null
  branchName: string | null
  /** Live stock at that branch — seeds the availability hint. */
  stockQuantity: number | null
}

export interface InvoiceEditGiftCardLine {
  code: string
  amount: number
  expiresOn: string | null
}

export interface InvoiceEditRedemption {
  code: string
  amount: number
}

/** Shape of GET /invoices/:id/edit — the invoice as entered, not as printed. */
export interface InvoiceEdit {
  id: string
  invoiceNumber: number
  date: string
  branchId: string | null
  branchName: string | null
  discount: number
  discountUnit: DiscountUnit
  paymentStatus: PaymentStatus
  amountPaid: number
  paymentType: PaymentType | null
  customerId: string | null
  customers: InvoiceEditCustomer[]
  products: InvoiceEditProductLine[]
  giftCards: InvoiceEditGiftCardLine[]
  giftCardRedemptions: InvoiceEditRedemption[]
}
