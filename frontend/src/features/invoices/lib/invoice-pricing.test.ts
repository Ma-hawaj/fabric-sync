import { describe, expect, it } from 'vitest'
import { computeOrderLineTotal } from './invoice-pricing'
import { createEmptyOrder } from '../types/invoice-form'
import { MATERIALS } from '../data/invoice-form-options'

const woolBlend = MATERIALS.find((m) => m.name.includes('Wool Blend'))!

describe('computeOrderLineTotal', () => {
  it('multiplies the material price per meter by the quantity', () => {
    const order = {
      ...createEmptyOrder(),
      materialId: woolBlend.id,
      materialAmount: 3,
    }
    expect(computeOrderLineTotal(order)).toBe(woolBlend.pricePerMeter * 3)
  })

  it('returns 0 when no material is selected', () => {
    const order = { ...createEmptyOrder(), materialAmount: 5 }
    expect(computeOrderLineTotal(order)).toBe(0)
  })

  it('returns 0 when quantity is blank', () => {
    const order = {
      ...createEmptyOrder(),
      materialId: woolBlend.id,
      materialAmount: '' as const,
    }
    expect(computeOrderLineTotal(order)).toBe(0)
  })

  it('returns 0 when quantity is zero or negative', () => {
    const order = {
      ...createEmptyOrder(),
      materialId: woolBlend.id,
      materialAmount: -2,
    }
    expect(computeOrderLineTotal(order)).toBe(0)
  })

  it('rounds to 2 decimal places, avoiding floating point drift', () => {
    const order = {
      ...createEmptyOrder(),
      materialId: woolBlend.id,
      materialAmount: 0.1,
    }
    // 32 * 0.1 === 3.2000000000000006 in plain floating point arithmetic.
    const result = computeOrderLineTotal(order)
    expect(result).toBe(Math.round(woolBlend.pricePerMeter * 0.1 * 100) / 100)
    expect(Number.isInteger(result * 100)).toBe(true)
  })
})
