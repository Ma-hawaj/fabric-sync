export type OrderStatus = 'pending' | 'received'
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid'
export type PaymentType = 'benefit' | 'cash' | 'card'

/** `pending` is the absence of a recorded action, not a stored value. */
export type OrderStageStatus = 'pending' | 'done' | 'skipped'
export type RepairStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

// One entry of an assembled checklist. The backend derives these by overlaying
// what has been recorded onto the live stage catalog, so a stage added or
// retired on the Order Stages page shows up here immediately.
export interface OrderStageEntry {
  stageId: string
  name: string
  sortOrder: number
  requiresDelivery: boolean
  /**
   * False when a delivery stage doesn't apply because the garment is produced
   * where the customer collects it. A non-applicable entry never blocks the
   * order.
   */
  applicable: boolean
  status: OrderStageStatus
  /**
   * Derived, not stored: the moment the previous stage finished (or the pass
   * began, for the first stage). Set once a stage is recorded, or for the one
   * currently outstanding; null for anything further down the queue.
   */
  startedAt: string | null
  completedAt: string | null
  locationId: string | null
  location: string | null
  notes: string | null
}

// A return for rework. An order can accumulate several over its life, each with
// its own independent pass through the same checklist.
export interface OrderRepair {
  id: string
  reason: string
  reportedOn: string
  charge: number
  status: RepairStatus
  completedAt: string | null
  notes: string | null
  stages: OrderStageEntry[]
  currentStage: string | null
}

// One row of GET /orders — an order line joined with its invoice, customer,
// and material. invoiceDate arrives as an ISO date string and is parsed to a
// Date in use-orders.ts for the table's date-range filter.
//
// An invoice is settled in up to two payments: an advance taken up front (at
// invoice creation) and a final payment that clears the remaining balance
// (when the order is received) — each may use a different payment method,
// hence the separate advance/final payment type fields.
export interface Order {
  id: string
  invoiceId: string
  invoiceDate: Date
  measurementId: string
  customerName: string
  customerMobile: string
  material: string
  materialAmount: number
  price: number
  status: OrderStatus
  /**
   * Where the garment is made. An explicit assignment always wins; absent
   * one, a material stocked at exactly one location is inferred — see
   * productionLocationInferred. Null when neither is available.
   */
  productionLocationId: string | null
  productionLocation: string | null
  /** True when productionLocation was inferred rather than assigned by staff. */
  productionLocationInferred: boolean
  /** Where the customer collects, taken from the invoice's branch. */
  receivingLocationId: string | null
  receivingLocation: string | null
  stages: OrderStageEntry[]
  /** First applicable stage still outstanding; null once the build is done. */
  currentStage: string | null
  repairs: OrderRepair[]
  invoiceTotalPrice: number
  invoiceAmountPaid: number
  invoicePaymentStatus: InvoicePaymentStatus
  invoiceAdvanceAmount: number
  invoiceAdvancePaymentType: PaymentType | null
  invoiceFinalPaymentType: PaymentType | null
}
