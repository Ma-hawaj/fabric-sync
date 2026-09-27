import type { ReactFormExtendedApi } from '@tanstack/react-form'
import { createEmptyMeasurement } from '@/features/customers/types/measurement-form'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'

export type CustomerMode = 'existing' | 'new'
export type PaymentType = 'benefit' | 'cash' | 'card'
// A flat amount in the business currency, or a percentage of the subtotal —
// deliberately not tied to a specific currency code (see lib/currency.ts).
export type DiscountUnit = 'amount' | 'percent'

// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface InvoiceOrderDraft {
  key: string

  thobeType: string
  fPocket: string
  collar: string
  sleeve: string
  patti: string
  moreDetails: string

  materialId: string
  materialAmount: NumberInput
  // Where materialAmount comes off — material stock is held per location, and
  // different orders on the same invoice can use materials stocked at
  // different locations, so this has to be per order rather than one
  // invoice-wide field (unlike productBranch, where every product line
  // sells from the same register).
  productionLocationId: string
  // Entered by staff per order line — materials carry no unit price to derive
  // it from.
  price: NumberInput
}

export interface InvoiceCustomerDraft {
  key: string
  mode: CustomerMode

  // mode: 'existing'
  existingCustomerId: string

  // mode: 'new'
  name: string
  mobileNo: string

  measurement: MeasurementDraft
  orders: InvoiceOrderDraft[]
}

// A retail line. Unlike an order, a product is priced per unit and multiplied
// out, since products carry a list price the picker prefills.
export interface InvoiceProductDraft {
  key: string
  productId: string
  quantity: NumberInput
  unitPrice: NumberInput
}

// A gift card sold on this invoice. Selling stored value is not a taxable
// supply, so its amount is added to the total outside the VAT base.
export interface InvoiceGiftCardDraft {
  key: string
  code: string
  amount: NumberInput
  // ISO date, or blank for a card that never expires.
  expiresOn: string
}

// A gift card spent on this invoice — tender, applied after VAT.
export interface GiftCardRedemptionDraft {
  key: string
  code: string
  amount: NumberInput
}

// One payment taken up front with the invoice. Later payments go through the
// receive endpoints or a till payment, so the form only ever carries the
// opening ones — usually zero or one row.
export interface PaymentDraft {
  key: string
  amount: NumberInput
  paymentType: PaymentType | ''
}

export interface InvoiceFormValues {
  date: string
  receivingBranch: string
  // Who a sale with no tailoring orders is billed to; a tailoring invoice
  // finds its customer through the orders instead.
  customerId: string
  // One "sold from" location for every product line, since product stock is
  // held per location. Distinct from receivingBranch, which is where a
  // finished order is collected.
  productBranch: string
  discount: NumberInput
  discountUnit: DiscountUnit
  payments: PaymentDraft[]
  customers: InvoiceCustomerDraft[]
  products: InvoiceProductDraft[]
  giftCards: InvoiceGiftCardDraft[]
  redemptions: GiftCardRedemptionDraft[]
}

// The validator generic slots are left as `any` — this form has no
// schema-level validators, only inline field checks, so pinning them down
// would just be 11 extra type params for no benefit.
export type InvoiceFormApi = ReactFormExtendedApi<
  InvoiceFormValues,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>

export function createEmptyOrder(): InvoiceOrderDraft {
  return {
    key: crypto.randomUUID(),
    thobeType: '',
    fPocket: '',
    collar: '',
    sleeve: '',
    patti: '',
    moreDetails: '',
    materialId: '',
    materialAmount: '',
    productionLocationId: '',
    price: '',
  }
}

export function createEmptyCustomer(): InvoiceCustomerDraft {
  return {
    key: crypto.randomUUID(),
    mode: 'existing',
    existingCustomerId: '',
    name: '',
    mobileNo: '',
    measurement: createEmptyMeasurement(),
    orders: [createEmptyOrder()],
  }
}

// The form page and the schema tests both build from here, so a new field
// can't be added to InvoiceFormValues without both picking it up.
export function createEmptyInvoiceForm(): InvoiceFormValues {
  return {
    date: new Date().toISOString().slice(0, 10),
    receivingBranch: '',
    customerId: '',
    productBranch: '',
    discount: '',
    discountUnit: 'amount',
    // One blank row, like the old single advance: an untouched blank is
    // tolerated by the schema and dropped by the payload, so an unpaid
    // invoice submits no payments.
    payments: [createEmptyPayment()],
    customers: [createEmptyCustomer()],
    products: [],
    giftCards: [],
    redemptions: [],
  }
}

export function createEmptyPayment(): PaymentDraft {
  return {
    key: crypto.randomUUID(),
    amount: '',
    paymentType: '',
  }
}

export function createEmptyProductLine(): InvoiceProductDraft {
  return {
    key: crypto.randomUUID(),
    productId: '',
    quantity: 1,
    unitPrice: '',
  }
}

export function createEmptyGiftCardLine(): InvoiceGiftCardDraft {
  return {
    key: crypto.randomUUID(),
    code: '',
    amount: '',
    expiresOn: '',
  }
}

export function createEmptyRedemption(): GiftCardRedemptionDraft {
  return {
    key: crypto.randomUUID(),
    code: '',
    amount: '',
  }
}
