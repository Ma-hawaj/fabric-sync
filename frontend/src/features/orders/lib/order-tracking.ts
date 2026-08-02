import type {
  Order,
  OrderStageEntry,
  OrderStageStatus,
  RepairStatus,
} from '../types/orders'

// The single place the tracking display rules live, mirroring the derivation in
// the Rust service. The Stage column, the Repairs column, and the tracking sheet
// all read from here rather than re-deriving labels inline.

export const NOT_STARTED = 'Not started'
export const COMPLETED = 'Completed'

/**
 * What the Stage column shows. `currentStage` is null once every applicable
 * stage is done or skipped; nothing recorded at all reads as not started, which
 * is a more useful distinction on the list than repeating the first stage name.
 */
export function currentStageLabel(order: Order): string {
  if (order.currentStage === null) return COMPLETED
  const untouched = order.stages.every((stage) => stage.status === 'pending')
  return untouched ? NOT_STARTED : order.currentStage
}

/** Every label the Stage filter can offer, in checklist order. */
export function stageFilterOptions(orders: Order[]): string[] {
  const names = new Map<string, number>()
  for (const order of orders) {
    for (const stage of order.stages) {
      names.set(stage.name, stage.sortOrder)
    }
  }
  const ordered = [...names.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)

  return [NOT_STARTED, ...ordered, COMPLETED]
}

export function stageBadgeVariant(
  status: OrderStageStatus,
): 'default' | 'secondary' | 'outline' {
  if (status === 'done') return 'default'
  if (status === 'skipped') return 'secondary'
  return 'outline'
}

export function stageStatusLabel(entry: OrderStageEntry): string {
  if (!entry.applicable) return 'Not needed'
  if (entry.status === 'done') return 'Done'
  if (entry.status === 'skipped') return 'Skipped'
  return 'Pending'
}

const stageDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * "Jul 20, 10:03 AM → Jul 20, 2:15 PM" once a stage is done or skipped;
 * "Waiting since Jul 22, 9:00 AM" for the stage currently outstanding; null
 * for anything not yet reached. Start times are derived, not stored — a stage
 * starts the moment the previous one finished.
 */
export function stageTimingLabel(entry: OrderStageEntry): string | null {
  if (!entry.startedAt) return null

  const started = stageDateTimeFormatter.format(new Date(entry.startedAt))
  if (entry.completedAt) {
    const finished = stageDateTimeFormatter.format(new Date(entry.completedAt))
    return `${started} → ${finished}`
  }
  return `Waiting since ${started}`
}

const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function repairStatusLabel(status: RepairStatus): string {
  return REPAIR_STATUS_LABELS[status]
}

/** Cancelled and completed repairs are finished; the rest still need work. */
export function openRepairCount(order: Order): number {
  return order.repairs.filter(
    (repair) => repair.status === 'open' || repair.status === 'in_progress',
  ).length
}
