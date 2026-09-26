import type {
  GiftCardRedemptionDraft,
  InvoiceGiftCardDraft,
  InvoiceOrderDraft,
  InvoiceProductDraft,
  NumberInput,
} from '../types/invoice-form'

// Keep in step with VAT_RATE in the backend's invoices service: line prices
// are entered gross (VAT included) and the tax is extracted from the
// discounted gross rather than added on top.
export const VAT_RATE = 0.1

export function numberOrZero(value: NumberInput): number {
  return value === '' ? 0 : value
}

// Each order line's price is entered by staff (materials carry no unit
// price); a blank or non-positive entry counts as 0 in the summary.
export function computeOrderLineTotal(order: InvoiceOrderDraft): number {
  return typeof order.price === 'number' && order.price > 0 ? order.price : 0
}

// A product line is the one thing priced per unit — products carry a list
// price, so the quantity is a real multiplier rather than metres consumed.
// The unit price is gross (VAT included), like an order price.
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

// The net (taxable) part inside a gross figure, and the VAT inside it. The
// VAT is the remainder — gross minus net — so the two always add back to the
// gross the customer was quoted, to the fils.
export function extractNet(gross: number): number {
  return Math.round((gross / (1 + VAT_RATE)) * 100) / 100
}

export function extractVat(gross: number): number {
  return Math.round((gross - extractNet(gross)) * 100) / 100
}

export interface InvoiceGrossTotals {
  /** Everything VAT applies to, as entered gross. */
  grossSubtotal: number
  giftCardSales: number
  discountAmount: number
  /** The discounted gross — what the customer actually owes before tender. */
  gross: number
  taxable: number
  vat: number
  total: number
  redeemed: number
  paid: number
  balanceDue: number
}

function discountOf(
  grossSubtotal: number,
  discount: number,
  discountUnit: 'amount' | 'percent',
): number {
  const raw =
    discountUnit === 'percent' ? grossSubtotal * (discount / 100) : discount
  return Math.min(Math.round(raw * 100) / 100, grossSubtotal)
}

// The same arithmetic the backend's breakdown runs, for live form totals:
// discount off the gross, VAT extracted from the discounted gross, gift
// cards joining the total untaxed, tender netted off the balance.
export function computeInvoiceTotals(input: {
  orderTotal: number
  productTotal: number
  giftCardSales: number
  discount: number
  discountUnit: 'amount' | 'percent'
  redeemed: number
  paid: number
}): InvoiceGrossTotals {
  const grossSubtotal =
    Math.round((input.orderTotal + input.productTotal) * 100) / 100
  const discountAmount = discountOf(
    grossSubtotal,
    input.discount,
    input.discountUnit,
  )
  const gross = Math.round((grossSubtotal - discountAmount) * 100) / 100
  const taxable = extractNet(gross)
  const vat = extractVat(gross)
  const giftCardSales = Math.round(input.giftCardSales * 100) / 100
  const total = Math.round((gross + giftCardSales) * 100) / 100
  const redeemed = Math.min(input.redeemed, total)
  const paid = input.paid
  const balanceDue = Math.max(total - redeemed - paid, 0)

  return {
    grossSubtotal,
    giftCardSales,
    discountAmount,
    gross,
    taxable,
    vat,
    total,
    redeemed,
    paid,
    balanceDue,
  }
}
