import type { ReactFormExtendedApi } from '@tanstack/react-form'
import { createEmptyMeasurement } from '@/features/customers/types/measurement-form'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'
import type { CURRENCY } from '@/lib/currency'

export type CustomerMode = 'existing' | 'new'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type DiscountUnit = typeof CURRENCY | '%'

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

export interface InvoiceFormValues {
  date: string
  receivingBranch: string
  discount: NumberInput
  discountUnit: DiscountUnit
  paymentStatus: PaymentStatus
  amountPaid: NumberInput
  customers: InvoiceCustomerDraft[]
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
