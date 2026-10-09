export interface Measurement {
  id: string
  customerId: string
  date: Date

  // Body Dimensions
  lengthFl?: number | null
  lengthBl?: number | null
  chest?: number | null
  waist?: number | null
  hips?: number | null
  shoulder?: number | null
  shoulderDown?: number | null
  sleeveLength?: number | null
  neck?: number | null
  openHand?: number | null
  openHandFolding?: number | null

  // Extra Details
  chestUp?: number | null
  cuffWidth?: number | null
  cuffling?: number | null
  neckWidth?: number | null
  armHole?: number | null
  foWidth?: number | null
  fo?: number | null
  sleeveHalf?: number | null
  button?: number | null
  buttonFold?: number | null
  openFold?: number | null
  bottom?: number | null
  bottomFolding?: number | null
  fullBody?: number | null
  frontPocketLength?: number | null
  frontPocketLengthByWidth?: string | null
  sidePocketLength?: number | null
  sidePocketLengthByWidth?: string | null
  mobilePocketLengthByWidth?: string | null
}

export interface Customer {
  id: string
  name: string
  nameArabic?: string
  mobileNo: string
  measurements: Measurement[]
  /** The customer's invoices, newest first — tailoring plus direct retail. */
  invoices: CustomerInvoiceSummary[]
}

// One invoice as embedded on a customer: identity, dates and money state.
// Dates arrive as ISO strings and are parsed to Dates.
export interface CustomerInvoiceSummary {
  id: string
  invoiceNumber: number
  invoiceDate: Date
  targetDate: Date
  totalPrice: number
  paymentStatus: 'unpaid' | 'partial' | 'paid'
  balanceDue: number
}

type CustomerInvoiceSummaryDto = Omit<
  CustomerInvoiceSummary,
  'invoiceDate' | 'targetDate'
> & {
  invoiceDate: string
  targetDate: string
}

type CustomerDto = Omit<Customer, 'measurements' | 'invoices'> & {
  measurements?: (Omit<Measurement, 'date'> & { date: string })[]
  invoices?: CustomerInvoiceSummaryDto[]
}

// Dates arrive as ISO strings off the wire; the rest of the app expects real
// Dates. Applied to each row, for the list hooks (via `select`) and the
// by-id hook alike.
export function toCustomer(dto: CustomerDto): Customer {
  return {
    ...dto,
    measurements: (dto.measurements ?? []).map((measurement) => ({
      ...measurement,
      date: new Date(measurement.date),
    })),
    invoices: (dto.invoices ?? []).map((invoice) => ({
      ...invoice,
      invoiceDate: new Date(invoice.invoiceDate),
      targetDate: new Date(invoice.targetDate),
    })),
  }
}
