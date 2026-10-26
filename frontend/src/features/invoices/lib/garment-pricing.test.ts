import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createEmptyOrder } from '../types/invoice-form'
import {
  calculateGarmentPrice,
  preservesOriginalOrderPricing,
  calculateUrgentCharge,
  JUNIOR_BELOW_METRES,
  LARGE_ABOVE_METRES,
} from './garment-pricing'
import type { Material } from '../types/materials'
import type { DesignOption } from '@/features/design-options/types/design-option'

describe('automatic urgent pricing', () => {
  it('calculates a fixed or percentage charge without manual input', () => {
    expect(calculateUrgentCharge(22.5, { amount: 5, unit: 'amount' })).toBe(5)
    expect(calculateUrgentCharge(27.5, { amount: 10, unit: 'percent' })).toBe(
      2.75,
    )
    expect(calculateUrgentCharge(22.55, { amount: 10, unit: 'percent' })).toBe(
      2.26,
    )
    expect(calculateUrgentCharge(20, null)).toBe('')
    expect(calculateUrgentCharge('', { amount: 5, unit: 'amount' })).toBe('')
  })
})

const material: Material = {
  id: 'm1',
  name: 'Cotton',
  sku: null,
  family: null,
  unit: 'meters',
  locations: [],
  juniorPrice: 10,
  normalPrice: 20,
  largePrice: 30,
}
const option = (category: string, cost: number): DesignOption => ({
  id: category,
  category,
  slug: 'same',
  label: 'Same',
  cost,
  sortOrder: 1,
  isActive: true,
  hasImage: false,
  imageUrl: '',
})
const draft = () => ({
  ...createEmptyOrder(),
  materialId: 'm1',
  materialAmount: 3,
})

describe('garment pricing', () => {
  it.each([
    [2.99, 10, 'junior'],
    [3, 20, 'normal'],
    [4, 20, 'normal'],
    [4.01, 30, 'large'],
  ] as const)(
    'prices %s metres as a complete %s garment',
    (materialAmount, total, tier) => {
      expect(
        calculateGarmentPrice({ ...draft(), materialAmount }, material, []),
      ).toEqual({ base: total, total, tier, designCost: 0 })
    },
  )
  it('adds each selected design cost once, matching both category and slug', () => {
    const order = {
      ...draft(),
      materialAmount: 5,
      collar: 'same',
      sleeve: 'same',
    }
    expect(
      calculateGarmentPrice(order, material, [
        option('neck', 2.25),
        option('sleeve', 3.5),
      ]),
    ).toEqual({ base: 30, designCost: 5.75, total: 35.75, tier: 'large' })
  })
  it('adds designs to a customer tailoring base and clears them without accumulating costs', () => {
    const order = {
      ...draft(),
      materialSource: 'customer' as const,
      collar: 'same',
    }
    expect(
      calculateGarmentPrice(order, null, [option('neck', 2.5)], 15)?.total,
    ).toBe(17.5)
    expect(
      calculateGarmentPrice(
        { ...order, collar: '', materialAmount: 5 },
        null,
        [],
        15,
      )?.total,
    ).toBe(15)
  })
  it('rejects incomplete or invalid pricing instead of charging zero', () => {
    expect(calculateGarmentPrice(draft(), null, [])).toBeNull()
    expect(
      calculateGarmentPrice(draft(), { ...material, normalPrice: null }, []),
    ).toBeNull()
    expect(
      calculateGarmentPrice({ ...draft(), materialAmount: '' }, material, []),
    ).toBeNull()
    expect(
      calculateGarmentPrice({ ...draft(), collar: 'missing' }, material, []),
    ).toBeNull()
    expect(
      calculateGarmentPrice(
        { ...draft(), materialSource: 'customer' },
        null,
        [],
      ),
    ).toBeNull()
    expect(
      calculateGarmentPrice(
        { ...draft(), materialSource: 'customer' },
        null,
        [],
        -1,
      ),
    ).toBeNull()
  })
  it('accepts explicitly free garments and retired options retained on an edit', () => {
    expect(
      calculateGarmentPrice(draft(), { ...material, normalPrice: 0 }, [])
        ?.total,
    ).toBe(0)
    expect(
      calculateGarmentPrice({ ...draft(), collar: 'same' }, material, [
        { ...option('neck', 5), isActive: false },
      ])?.total,
    ).toBe(25)
  })
  it('keeps the backend and frontend metre constants in sync', () => {
    const backend = readFileSync(
      new NodeURL(
        '../../../../../backend/src/features/pricing/service.rs',
        import.meta.url,
      ),
      'utf8',
    )
    expect(
      Number(backend.match(/pub const JUNIOR_BELOW: f64 = ([\d.]+)/)?.[1]),
    ).toBe(JUNIOR_BELOW_METRES)
    expect(
      Number(backend.match(/pub const LARGE_ABOVE: f64 = ([\d.]+)/)?.[1]),
    ).toBe(LARGE_ABOVE_METRES)
  })
})

describe('saved order pricing', () => {
  const saved = () => {
    const order = draft()
    const inputs = {
      materialSource: order.materialSource,
      materialId: order.materialId,
      materialAmount: order.materialAmount,
      thobeType: order.thobeType,
      fPocket: order.fPocket,
      sPocket: order.sPocket,
      collar: order.collar,
      sleeve: order.sleeve,
      patti: order.patti,
      emd: order.emd,
      isUrgent: order.isUrgent,
    }
    return {
      ...order,
      originalOrderId: 'saved-order',
      originalPricing: { inputs, basePrice: 10, price: 10, urgentCharge: 0 },
    }
  }
  it('preserves notes, descriptions and location edits without repricing', () => {
    expect(
      preservesOriginalOrderPricing({
        ...saved(),
        moreDetails: 'Longer cuff',
        productionLocationId: 'other',
        customerMaterialDescription: 'Linen',
      }),
    ).toBe(true)
  })
  it.each([
    { materialId: 'different' },
    { materialAmount: 4.01 },
    { collar: 'same' },
    { isUrgent: true },
    { materialSource: 'customer' as const },
  ])('reprices when a pricing input changes: %o', (change) => {
    expect(preservesOriginalOrderPricing({ ...saved(), ...change })).toBe(false)
  })
  it('requires an original server line reference', () => {
    expect(preservesOriginalOrderPricing(draft())).toBe(false)
    expect(
      preservesOriginalOrderPricing({ ...saved(), originalOrderId: undefined }),
    ).toBe(false)
  })
})
