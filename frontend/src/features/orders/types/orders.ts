import type { Measurement } from '@/features/customers/types/customers'

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
  /**
   * Who's assigned, independent of `status` — a stage can be assigned before
   * it's done. Null when nobody has been assigned.
   */
  assigneeId: string | null
  assigneeName: string | null
}

// A return for rework. An order can accumulate several over its life. A
// repair is tracked by its own record and status, not a second pass through
// the order's stage checklist.
export interface OrderRepair {
  id: string
  reason: string
  reportedOn: string
  charge: number
  status: RepairStatus
  completedAt: string | null
  notes: string | null
}

// One row of GET /orders — an order line joined with its invoice, customer,
// and material. invoiceDate arrives as an ISO date string and is parsed to a
// Date in use-orders.ts for the table's date-range filter.
//
// An invoice is settled through any number of payments (the ledger);
// invoiceAmountPaid is their sum and invoicePaymentMethod the most recent
// one's method.
export interface Order {
  id: string
  /**
   * The tailor-quotable identity (`ORD-###`) — a bare number here, formatted
   * for display by the consumer, the same way `OrderDetail.invoiceNumber`
   * stays a number below.
   */
  orderNumber: number
  invoiceId: string
  /** The parent invoice's number, shown next to the order's own. */
  invoiceNumber: number
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
  invoiceBalanceDue: number
  /** Gift card tender on the invoice — settled alongside ledger payments. */
  invoiceGiftCardRedeemed: number
  invoicePaymentMethod: PaymentType | null
}

// Shape of GET /orders/:id — the whole order row plus the measurement
// snapshot the garment was cut to (the one the invoice's order links to, not
// the customer's full history). Both readable numbers ride along: the
// order's own (`orderNumber`) titles the page, the invoice's
// (`invoiceNumber`) names the bill it belongs to.
export interface OrderDetail extends Order {
  /**
   * The invoice's human-readable identity (`INV-###`) — a tax invoice needs a
   * number you can hand someone, and the uuidv7 order id gives neither.
   */
  invoiceNumber: number
  /**
   * The exact measurements taken for this garment. A repeat order cuts to a
   * fresh snapshot, so this is one Measurement, not a list.
   */
  measurement: Measurement
}
