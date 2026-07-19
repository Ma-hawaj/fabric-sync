import { MATERIALS } from '../data/invoice-form-options'
import type { InvoiceOrderDraft } from '../types/invoice-form'

export function computeOrderLineTotal(order: InvoiceOrderDraft): number {
  const material = MATERIALS.find((m) => m.id === order.materialId)
  const quantity =
    typeof order.materialAmount === 'number' ? order.materialAmount : 0
  if (!material || quantity <= 0) return 0
  return Math.round(material.pricePerMeter * quantity * 100) / 100
}
