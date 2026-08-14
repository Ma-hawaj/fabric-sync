import {
  NOT_STARTED,
  currentStageLabel,
} from '@/features/orders/lib/order-tracking'
import { bucketKey, withinRange } from './period'
import type { BucketSize, TimeBucket } from './period'
import type { Invoice, PaymentType } from '@/features/invoices/types/invoices'
import type { Material } from '@/features/inventory/types/inventory'
import type { Order, RepairStatus } from '@/features/orders/types/orders'

// Every number the analytics page draws is derived here, in pure functions
// over the lists the existing feature hooks already fetch — there is no
// analytics endpoint. That keeps the page honest about where a figure comes
// from (an invoice total is not an order price) and makes each derivation
// testable without a DB or a rendered chart.
//
// Two money scales live on this page and must not be added together:
//   * invoice totals  — what was billed, VAT and retail lines included
//   * order prices    — the tailoring line alone, which is what carries a
//                       material and a production location
// Anything cut by material, branch or stage is order money; the headline
// financials are invoice money. Labels say which.

const MAX_MATERIAL_SLICES = 8

/** Invoice dates arrive as `YYYY-MM-DD`, which parses to UTC midnight. */
export function invoiceDate(invoice: Invoice): Date {
  return new Date(invoice.date)
}

export function invoicesInRange(
  invoices: Invoice[],
  bounds: { start: Date | null; end: Date },
): Invoice[] {
  return invoices.filter((invoice) => withinRange(invoiceDate(invoice), bounds))
}

export function ordersInRange(
  orders: Order[],
  bounds: { start: Date | null; end: Date },
): Order[] {
  return orders.filter((order) => withinRange(order.invoiceDate, bounds))
}

/** The oldest date in the data — what 'All time' starts its buckets from. */
export function earliestDate(
  invoices: Invoice[],
  orders: Order[],
): Date | null {
  const times = [
    ...invoices.map((invoice) => invoiceDate(invoice).getTime()),
    ...orders.map((order) => order.invoiceDate.getTime()),
  ].filter((time) => Number.isFinite(time))

  return times.length ? new Date(Math.min(...times)) : null
}

export interface FinancialSummary {
  /** Billed, VAT included. */
  invoiced: number
  collected: number
  /** Never negative: an overpayment is not a debt. */
  outstanding: number
  invoiceCount: number
  orderCount: number
  /** Mean tailoring line price, not mean invoice. */
  averageOrderValue: number
}

export function financialSummary(
  invoices: Invoice[],
  orders: Order[],
): FinancialSummary {
  const invoiced = sum(invoices, (invoice) => invoice.totalPrice)
  const collected = sum(invoices, (invoice) => invoice.amountPaid)
  const orderValue = sum(orders, (order) => order.price)

  return {
    invoiced,
    collected,
    outstanding: Math.max(invoiced - collected, 0),
    invoiceCount: invoices.length,
    orderCount: orders.length,
    averageOrderValue: orders.length ? orderValue / orders.length : 0,
  }
}

/**
 * Percentage change, or null when there's no meaningful baseline — a jump
 * from nothing is not "+100%", and 'All time' has no previous window at all.
 */
export function deltaPercent(
  current: number,
  previous: number | null,
): number | null {
  if (previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

export interface TrendPoint {
  key: string
  label: string
  invoiced: number
  collected: number
}

export function revenueTrend(
  invoices: Invoice[],
  buckets: TimeBucket[],
  bucket: BucketSize,
): TrendPoint[] {
  if (buckets.length === 0) return []
  const anchor = buckets[0].start

  const points = new Map<string, TrendPoint>(
    buckets.map((entry) => [
      entry.key,
      { key: entry.key, label: entry.label, invoiced: 0, collected: 0 },
    ]),
  )

  for (const invoice of invoices) {
    const point = points.get(bucketKey(invoiceDate(invoice), bucket, anchor))
    if (!point) continue
    point.invoiced += invoice.totalPrice
    point.collected += invoice.amountPaid
  }

  return [...points.values()]
}

export interface PaymentMethodTotal {
  method: string
  amount: number
}

const PAYMENT_METHOD_LABELS: Record<PaymentType, string> = {
  cash: 'Cash',
  card: 'Card',
  benefit: 'Benefit',
}

/**
 * What was actually collected, split by how it was taken. An invoice settles
 * in up to two payments with their own methods: the advance recorded up
 * front, then whatever cleared the balance. Money paid against an invoice
 * whose method was never recorded is reported as such rather than dropped —
 * a split that silently loses cash is worse than one that admits a gap.
 */
export function collectedByPaymentMethod(
  invoices: Invoice[],
): PaymentMethodTotal[] {
  const totals = new Map<string, number>(
    Object.values(PAYMENT_METHOD_LABELS).map((label) => [label, 0]),
  )
  let unrecorded = 0

  const add = (label: string, amount: number) => {
    totals.set(label, (totals.get(label) ?? 0) + amount)
  }

  for (const invoice of invoices) {
    const advance = Math.min(invoice.advanceAmount, invoice.amountPaid)
    const settled = invoice.amountPaid - advance

    if (advance > 0) {
      if (invoice.advancePaymentType) {
        add(PAYMENT_METHOD_LABELS[invoice.advancePaymentType], advance)
      } else {
        unrecorded += advance
      }
    }
    if (settled > 0) {
      if (invoice.finalPaymentType) {
        add(PAYMENT_METHOD_LABELS[invoice.finalPaymentType], settled)
      } else {
        unrecorded += settled
      }
    }
  }

  const methods = [...totals.entries()].map(([method, amount]) => ({
    method,
    amount,
  }))
  if (unrecorded > 0)
    methods.push({ method: 'Not recorded', amount: unrecorded })

  return methods.sort((a, b) => b.amount - a.amount)
}

export interface BranchTotal {
  branch: string
  value: number
  orders: number
}

/** Order value by where the customer collects — the invoice's branch. */
export function orderValueByBranch(orders: Order[]): BranchTotal[] {
  const totals = new Map<string, BranchTotal>()

  for (const order of orders) {
    const branch = order.receivingLocation ?? 'Unassigned'
    const entry = totals.get(branch) ?? { branch, value: 0, orders: 0 }
    entry.value += order.price
    entry.orders += 1
    totals.set(branch, entry)
  }

  return [...totals.values()].sort((a, b) => b.value - a.value)
}

export interface MaterialTotal {
  material: string
  value: number
  metres: number
  orders: number
}

/**
 * Highest-earning materials, with the tail folded into one "Other" row rather
 * than drawn as its own slice — past a handful of bars the ranking stops
 * being readable and the tail is what matters, not its members.
 */
export function topMaterialsByValue(
  orders: Order[],
  limit = MAX_MATERIAL_SLICES,
): MaterialTotal[] {
  const totals = new Map<string, MaterialTotal>()

  for (const order of orders) {
    const entry = totals.get(order.material) ?? {
      material: order.material,
      value: 0,
      metres: 0,
      orders: 0,
    }
    entry.value += order.price
    entry.metres += order.materialAmount
    entry.orders += 1
    totals.set(order.material, entry)
  }

  const ranked = [...totals.values()].sort((a, b) => b.value - a.value)
  if (ranked.length <= limit) return ranked

  const head = ranked.slice(0, limit)
  const tail = ranked.slice(limit)
  head.push({
    material: 'Other',
    value: sum(tail, (entry) => entry.value),
    metres: sum(tail, (entry) => entry.metres),
    orders: sum(tail, (entry) => entry.orders),
  })

  return head
}

export interface MaterialDemand {
  material: string
  /** Metres consumed by orders in the period. */
  used: number
  /** Metres on hand right now, across every location. */
  stock: number
}

/**
 * Consumption against what's left, both in metres so they share one axis.
 * Materials are matched by name because that is all an order carries. A
 * material with demand but no stock row still appears, at zero — that is the
 * case worth seeing.
 */
export function materialDemandVsStock(
  orders: Order[],
  materials: Material[],
  limit = MAX_MATERIAL_SLICES,
): MaterialDemand[] {
  const used = new Map<string, number>()
  for (const order of orders) {
    used.set(
      order.material,
      (used.get(order.material) ?? 0) + order.materialAmount,
    )
  }

  const stock = new Map<string, number>()
  for (const material of materials) {
    stock.set(
      material.name,
      sum(material.locations, (location) => location.quantity),
    )
  }

  return [...used.entries()]
    .map(([material, metres]) => ({
      material,
      used: metres,
      stock: stock.get(material) ?? 0,
    }))
    .sort((a, b) => b.used - a.used)
    .slice(0, limit)
}

export interface StageLoad {
  stage: string
  orders: number
}

/**
 * Where unfinished work is sitting right now, in checklist order. Finished
 * orders are left out — this is the queue, and a growing "Completed" bar
 * would flatten everything that still needs doing.
 */
export function workInProgressByStage(orders: Order[]): StageLoad[] {
  const positions = stagePositions(orders)
  const counts = new Map<string, number>()

  for (const order of orders) {
    const label = currentStageLabel(order)
    if (order.currentStage === null) continue // finished
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([stage, count]) => ({ stage, orders: count }))
    .sort(
      (a, b) => stageRank(a.stage, positions) - stageRank(b.stage, positions),
    )
}

export function completedOrderCount(orders: Order[]): number {
  return orders.filter((order) => order.currentStage === null).length
}

export interface StageDuration {
  stage: string
  /** Mean wall-clock hours from the stage starting to being recorded. */
  hours: number
  /** How many recorded stages went into the mean. */
  samples: number
}

/**
 * How long each stage takes on average. Start times are derived by the
 * backend (a stage starts when the previous one finished), so only stages
 * carrying both a start and a completion count — a skipped stage measures
 * nothing, and an outstanding one has not finished yet.
 */
export function averageStageDuration(orders: Order[]): StageDuration[] {
  const positions = stagePositions(orders)
  const totals = new Map<string, { hours: number; samples: number }>()

  for (const order of orders) {
    for (const stage of order.stages) {
      if (stage.status !== 'done' || !stage.startedAt || !stage.completedAt) {
        continue
      }
      const hours =
        (new Date(stage.completedAt).getTime() -
          new Date(stage.startedAt).getTime()) /
        (1000 * 60 * 60)
      if (!Number.isFinite(hours) || hours < 0) continue

      const entry = totals.get(stage.name) ?? { hours: 0, samples: 0 }
      entry.hours += hours
      entry.samples += 1
      totals.set(stage.name, entry)
    }
  }

  return [...totals.entries()]
    .map(([stage, entry]) => ({
      stage,
      hours: entry.hours / entry.samples,
      samples: entry.samples,
    }))
    .sort(
      (a, b) => stageRank(a.stage, positions) - stageRank(b.stage, positions),
    )
}

/** When the last applicable stage was recorded, for an order that's through. */
export function orderCompletedAt(order: Order): Date | null {
  if (order.currentStage !== null) return null

  const times = order.stages
    .filter((stage) => stage.completedAt)
    .map((stage) => new Date(stage.completedAt as string).getTime())
    .filter((time) => Number.isFinite(time))

  return times.length ? new Date(Math.max(...times)) : null
}

export interface ThroughputPoint {
  key: string
  label: string
  placed: number
  completed: number
}

/**
 * Orders taken in against orders finished, per bucket. Both series come from
 * the same period-scoped set of orders; a completion that lands outside the
 * window has no bucket to go in and is left out, so the two lines always
 * describe the slice on screen.
 */
export function throughput(
  orders: Order[],
  buckets: TimeBucket[],
  bucket: BucketSize,
): ThroughputPoint[] {
  if (buckets.length === 0) return []
  const anchor = buckets[0].start

  const points = new Map<string, ThroughputPoint>(
    buckets.map((entry) => [
      entry.key,
      { key: entry.key, label: entry.label, placed: 0, completed: 0 },
    ]),
  )

  for (const order of orders) {
    const placed = points.get(bucketKey(order.invoiceDate, bucket, anchor))
    if (placed) placed.placed += 1

    const finishedAt = orderCompletedAt(order)
    if (!finishedAt) continue
    const completed = points.get(bucketKey(finishedAt, bucket, anchor))
    if (completed) completed.completed += 1
  }

  return [...points.values()]
}

export interface RepairBreakdown {
  statuses: { status: RepairStatus; label: string; count: number }[]
  /** Share of orders that came back at least once, as a percentage. */
  reworkRate: number
  /** Repairs still open or in progress. */
  outstanding: number
  total: number
}

const REPAIR_STATUS_ORDER: { status: RepairStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'completed', label: 'Completed' },
  { status: 'cancelled', label: 'Cancelled' },
]

export function repairBreakdown(orders: Order[]): RepairBreakdown {
  const counts = new Map<RepairStatus, number>()
  let total = 0

  for (const order of orders) {
    for (const repair of order.repairs) {
      counts.set(repair.status, (counts.get(repair.status) ?? 0) + 1)
      total += 1
    }
  }

  const returned = orders.filter((order) => order.repairs.length > 0).length

  return {
    statuses: REPAIR_STATUS_ORDER.map(({ status, label }) => ({
      status,
      label,
      count: counts.get(status) ?? 0,
    })),
    reworkRate: orders.length ? (returned / orders.length) * 100 : 0,
    outstanding: (counts.get('open') ?? 0) + (counts.get('in_progress') ?? 0),
    total,
  }
}

/**
 * Both lists cut to the same window in one call — the current period or, with
 * `range.previous`, the one before it.
 */
export function sliceFor(
  orders: Order[],
  invoices: Invoice[],
  bounds: { start: Date | null; end: Date },
) {
  return {
    orders: ordersInRange(orders, bounds),
    invoices: invoicesInRange(invoices, bounds),
  }
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0)
}

/** Catalog order, read off whatever stages the orders on screen carry. */
function stagePositions(orders: Order[]): Map<string, number> {
  const positions = new Map<string, number>()
  for (const order of orders) {
    for (const stage of order.stages) {
      positions.set(stage.name, stage.sortOrder)
    }
  }
  return positions
}

function stageRank(label: string, positions: Map<string, number>): number {
  if (label === NOT_STARTED) return -1
  return positions.get(label) ?? Number.MAX_SAFE_INTEGER
}
