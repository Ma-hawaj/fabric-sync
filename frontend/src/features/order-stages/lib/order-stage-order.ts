import type { OrderStage } from '../types/order-stage'

// The order the backend returns stages in (sort_order, then name), kept in one
// place so every cache patch re-sorts the same way the list arrived.
export function byPosition(a: OrderStage, b: OrderStage): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
}
