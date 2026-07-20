import type { InvoiceOrderDraft } from '../types/invoice-form'

// Each order line's price is entered by staff (materials carry no unit
// price); a blank or non-positive entry counts as 0 in the summary.
export function computeOrderLineTotal(order: InvoiceOrderDraft): number {
  return typeof order.price === 'number' && order.price > 0 ? order.price : 0
}
