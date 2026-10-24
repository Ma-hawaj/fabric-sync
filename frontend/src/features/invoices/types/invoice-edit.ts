import type { DiscountUnit } from './invoice-form'
import type { InvoicePayment } from './invoice-detail'

/** Backend measurement fields as serialized camelCase (numbers stay null). */
export interface InvoiceEditMeasurement {
  date: string
  type: string | null
  fit: string | null
  frontHeight: number | null
  backHeight: number | null
  chest: number | null
  waist: number | null
  hip: number | null
  shoulder: number | null
  shoulderDown: number | null
  sleeveLength: number | null
  neckSize: number | null
  openHand: number | null
  chestUp: number | null
  cuffWidth: number | null
  cuffSize: number | null
  neckWidth: number | null
  armhole: number | null
  foWidth: number | null
  fo: number | null
  sleeveHalf: number | null
  openFold: number | null
  bottom: number | null
  bottomFold: number | null
  fullBody: number | null
  frontPocketLength: number | null
  frontPocketLengthByWidth: string | null
  sidePocket: number | null
  sidePocketLengthByWidth: string | null
  mobilePocketLengthByWidth: string | null
}

export interface InvoiceEditOrder {
  isUrgent: boolean
  materialSource: 'shop' | 'customer'
  customerMaterialDescription: string | null
  materialId: string | null
  materialName: string
  materialUnit: string
  materialAmount: number
  productionLocationId: string | null
  productionLocationName: string | null
  /** Live stock at the production location — seeds the "Made At" picker. */
  stockQuantity: number | null
  basePrice: number
  price: number
  urgentCharge: number
  thobeType: string | null
  fPocket: string | null
  sPocket: string | null
  collar: string | null
  sleeve: string | null
  patti: string | null
  emd: string | null
  moreDetails: string | null
}

export interface InvoiceEditCustomer {
  existingCustomerId: string
  customerName: string
  customerMobileNo: string
  customerAddress?: string | null
  /** The immutable snapshot currently referenced by the orders. */
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
  urgentCharge: number
  collectionMethod: 'delivery' | 'pickup'
  id: string
  invoiceNumber: number
  /** Server-set creation moment, as an ISO datetime with the time of day. */
  date: string
  /** The promised delivery date — the editable date on the form. Null when none was promised. */
  targetDate: string | null
  branchId: string | null
  branchName: string | null
  discount: number
  discountUnit: DiscountUnit
  /** Payments already taken; retained during edits and do not block editing. */
  payments: InvoicePayment[]
  customerId: string | null
  customers: InvoiceEditCustomer[]
  products: InvoiceEditProductLine[]
  giftCards: InvoiceEditGiftCardLine[]
  giftCardRedemptions: InvoiceEditRedemption[]
}
