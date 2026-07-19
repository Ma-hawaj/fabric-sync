import type { ReactFormExtendedApi } from '@tanstack/react-form'

export type CustomerMode = 'existing' | 'new'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type DiscountUnit = 'SAR' | '%'

// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface MeasurementDraft {
  // Id of the historical snapshot this was loaded from, if any. Editing
  // never overwrites it — saving always inserts a new dated measurement
  // record, whether loaded from history or started blank.
  loadedFromId: string | null
  date: string

  lengthFl: NumberInput
  lengthBl: NumberInput
  chest: NumberInput
  waist: NumberInput
  hips: NumberInput
  shoulder: NumberInput
  sleeveLength: NumberInput
  neck: NumberInput
  openHand: NumberInput
  cuffling: string

  fullBody: string
  chestUp: NumberInput
  openFold: string
  cuffWidth: NumberInput
  neckWidth: NumberInput
  aramHole: NumberInput
  sleeveHaffButton: string
  buttonFold: string
  fo: string
  foWidth: NumberInput
  frantPocketLength: NumberInput
  farntPocketLengthByWidth: string
  sidePocket: string
  mobilePocketLengthByWidth: string
}

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
  // Line total is derived from materialId + materialAmount (see
  // computeOrderLineTotal) rather than stored, so it can never drift out of
  // sync with the material's price per meter.
}

export interface InvoiceCustomerDraft {
  key: string
  mode: CustomerMode

  // mode: 'existing'
  existingCustomerId: string

  // mode: 'new'
  name: string
  nameArabic: string
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

export function createEmptyMeasurement(): MeasurementDraft {
  return {
    loadedFromId: null,
    date: new Date().toISOString().slice(0, 10),
    lengthFl: '',
    lengthBl: '',
    chest: '',
    waist: '',
    hips: '',
    shoulder: '',
    sleeveLength: '',
    neck: '',
    openHand: '',
    cuffling: '',
    fullBody: '',
    chestUp: '',
    openFold: '',
    cuffWidth: '',
    neckWidth: '',
    aramHole: '',
    sleeveHaffButton: '',
    buttonFold: '',
    fo: '',
    foWidth: '',
    frantPocketLength: '',
    farntPocketLengthByWidth: '',
    sidePocket: '',
    mobilePocketLengthByWidth: '',
  }
}

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
  }
}

export function createEmptyCustomer(): InvoiceCustomerDraft {
  return {
    key: crypto.randomUUID(),
    mode: 'existing',
    existingCustomerId: '',
    name: '',
    nameArabic: '',
    mobileNo: '',
    measurement: createEmptyMeasurement(),
    orders: [createEmptyOrder()],
  }
}
