import { describe, expect, it } from 'vitest'
import { computeOrderLineTotal } from './invoice-pricing'
import { createEmptyOrder } from '../types/invoice-form'

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
