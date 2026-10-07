import { describe, expect, it } from 'vitest'
import { createRemoveStockForm, removeStockSchema } from './remove-stock-schema'
import type { Material } from '../types/inventory'
import type { RemoveStockFormValues } from './remove-stock-schema'

const MATERIAL: Material = {
  id: 'mat-1',
  name: 'Japanese Toray Cotton',
  sku: null,
  unit: 'meters',
  locations: [
    { locationId: 'loc-1', location: 'Manama', quantity: 10 },
    { locationId: 'loc-2', location: 'Muharraq', quantity: 4 },
  ],
}

const AVAILABLE = { 'loc-1': 10, 'loc-2': 4 }

function values(
  entries: RemoveStockFormValues['entries'],
): RemoveStockFormValues {
  return { entries }
}

function firstError(input: RemoveStockFormValues) {
  const result = removeStockSchema(AVAILABLE).safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('removeStockSchema', () => {
  it('starts blank, which is valid to submit only with a quantity entered', () => {
    const blank = createRemoveStockForm(MATERIAL)
    expect(blank.entries).toHaveLength(2)
    expect(blank.entries.every((entry) => entry.quantity === '')).toBe(true)
    expect(firstError(blank)?.message).toMatch(
      /at least one quantity to remove/i,
    )
  })

  it('passes with one location filled in', () => {
    const input = values([
      { locationId: 'loc-1', quantity: 6 },
      { locationId: 'loc-2', quantity: '' },
    ])
    expect(removeStockSchema(AVAILABLE).safeParse(input).success).toBe(true)
  })

  it('rejects a non-positive quantity', () => {
    const input = values([
      { locationId: 'loc-1', quantity: 0 },
      { locationId: 'loc-2', quantity: '' },
    ])
    const error = firstError(input)
    expect(error?.message).toMatch(/greater than 0/i)
    expect(error?.path).toEqual(['entries', 0, 'quantity'])
  })

  it('rejects more than the location holds', () => {
    const input = values([
      { locationId: 'loc-1', quantity: '' },
      { locationId: 'loc-2', quantity: 5 },
    ])
    const error = firstError(input)
    expect(error?.message).toMatch(/more than this location holds/i)
    expect(error?.path).toEqual(['entries', 1, 'quantity'])
  })

  it('accepts the full available quantity', () => {
    const input = values([{ locationId: 'loc-2', quantity: 4 }])
    expect(removeStockSchema(AVAILABLE).safeParse(input).success).toBe(true)
  })
})
