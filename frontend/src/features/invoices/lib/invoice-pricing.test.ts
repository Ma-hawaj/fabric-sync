import { describe, expect, it } from 'vitest'
import {
  computeGiftCardLineTotal,
  computeInvoiceTotals,
  computeOrderLineTotal,
  computeProductLineTotal,
  extractNet,
  extractVat,
} from './invoice-pricing'
import {
  createEmptyGiftCardLine,
  createEmptyOrder,
  createEmptyProductLine,
} from '../types/invoice-form'

describe('computeOrderLineTotal', () => {
  it('returns the manually entered price', () => {
    const order = { ...createEmptyOrder(), price: 120.5 }
    expect(computeOrderLineTotal(order)).toBe(120.5)
  })

  it('returns 0 when the price is blank', () => {
    const order = { ...createEmptyOrder(), price: '' as const }
    expect(computeOrderLineTotal(order)).toBe(0)
  })

  it('returns 0 when the price is zero or negative', () => {
    const order = { ...createEmptyOrder(), price: -20 }
    expect(computeOrderLineTotal(order)).toBe(0)
  })
})

describe('computeProductLineTotal', () => {
  it('multiplies quantity by unit price', () => {
    const line = { ...createEmptyProductLine(), quantity: 3, unitPrice: 19.5 }
    expect(computeProductLineTotal(line)).toBe(58.5)
  })

  it('returns 0 when either side is blank', () => {
    expect(
      computeProductLineTotal({
        ...createEmptyProductLine(),
        quantity: '' as const,
        unitPrice: 20,
      }),
    ).toBe(0)
    expect(
      computeProductLineTotal({
        ...createEmptyProductLine(),
        quantity: 2,
        unitPrice: '' as const,
      }),
    ).toBe(0)
  })

  it('returns 0 when either side is zero or negative', () => {
    expect(
      computeProductLineTotal({
        ...createEmptyProductLine(),
        quantity: 0,
        unitPrice: 20,
      }),
    ).toBe(0)
    expect(
      computeProductLineTotal({
        ...createEmptyProductLine(),
        quantity: 2,
        unitPrice: -5,
      }),
    ).toBe(0)
  })
})

describe('extractNet / extractVat', () => {
  it('splits a gross figure so net and VAT add back to it', () => {
    expect(extractNet(100)).toBe(90.91)
    expect(extractVat(100)).toBe(9.09)
    expect(extractNet(100) + extractVat(100)).toBe(100)
  })
})

describe('computeInvoiceTotals', () => {
  const base = {
    orderTotal: 100,
    productTotal: 100,
    giftCardSales: 0,
    discount: 0,
    discountUnit: 'amount' as const,
    redeemed: 0,
    paid: 0,
  }

  it('charges the gross with VAT extracted, not added', () => {
    const totals = computeInvoiceTotals(base)
    expect(totals.total).toBe(200)
    expect(totals.taxable).toBe(181.82)
    expect(totals.vat).toBe(18.18)
  })

  it('takes the discount off the gross before extracting VAT', () => {
    const totals = computeInvoiceTotals({ ...base, discount: 20 })
    expect(totals.total).toBe(180)
    expect(totals.taxable + totals.vat).toBeCloseTo(180, 2)
  })

  it('nets tender off the balance due', () => {
    const totals = computeInvoiceTotals({ ...base, redeemed: 50, paid: 60 })
    expect(totals.balanceDue).toBe(90)
  })
})

describe('computeGiftCardLineTotal', () => {
  it('sells a card at its face value', () => {
    const line = { ...createEmptyGiftCardLine(), amount: 200 }
    expect(computeGiftCardLineTotal(line)).toBe(200)
  })

  it('returns 0 when the amount is blank or non-positive', () => {
    expect(
      computeGiftCardLineTotal({
        ...createEmptyGiftCardLine(),
        amount: '' as const,
      }),
    ).toBe(0)
    expect(
      computeGiftCardLineTotal({ ...createEmptyGiftCardLine(), amount: 0 }),
    ).toBe(0)
  })
})
