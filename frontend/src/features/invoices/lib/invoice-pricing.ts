import type {
  GiftCardRedemptionDraft,
  InvoiceGiftCardDraft,
  InvoiceOrderDraft,
  InvoiceProductDraft,
} from '../types/invoice-form'

// Each order line's price is entered by staff (materials carry no unit
// price); a blank or non-positive entry counts as 0 in the summary.
export function computeOrderLineTotal(order: InvoiceOrderDraft): number {
  return typeof order.price === 'number' && order.price > 0 ? order.price : 0
}

// A product line is the one thing priced per unit — products carry a list
// price, so the quantity is a real multiplier rather than metres consumed.
export function computeProductLineTotal(line: InvoiceProductDraft): number {
  const quantity = typeof line.quantity === 'number' ? line.quantity : 0
  const unitPrice = typeof line.unitPrice === 'number' ? line.unitPrice : 0
  return quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0
}

// A card is sold at face value — there is nothing to multiply out.
export function computeGiftCardLineTotal(line: InvoiceGiftCardDraft): number {
  return typeof line.amount === 'number' && line.amount > 0 ? line.amount : 0
}

export function computeRedemptionTotal(
  redemption: GiftCardRedemptionDraft,
): number {
  return typeof redemption.amount === 'number' && redemption.amount > 0
    ? redemption.amount
    : 0
}
