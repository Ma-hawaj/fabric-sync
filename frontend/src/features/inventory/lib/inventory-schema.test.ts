import { describe, expect, it } from 'vitest'
import { inventoryFormSchema } from './inventory-schema'
import {
  createEmptyInventoryForm,
  createEmptyStockEntry,
} from '../types/inventory-form'
import type { InventoryFormValues } from '../types/inventory-form'

function entry(locationId: string, quantity: number) {
  return { ...createEmptyStockEntry(), locationId, quantity }
}

function values(overrides: Partial<InventoryFormValues>): InventoryFormValues {
  return { ...createEmptyInventoryForm(), ...overrides }
}

function firstError(input: InventoryFormValues) {
  const result = inventoryFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('inventoryFormSchema', () => {
  it('requires three valid prices for a new material, including explicit zero prices', () => {
    const input = values({
      mode: 'new',
      name: 'Cotton',
      entries: [entry('loc-1', 5)],
      juniorPrice: 0,
      normalPrice: 20,
      largePrice: 30,
    })
    expect(firstError(input)).toBeNull()
    for (const invalid of [
      '',
      -1,
      0.001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ] as const) {
      expect(
        inventoryFormSchema.safeParse({ ...input, juniorPrice: invalid })
          .success,
      ).toBe(false)
    }
  })

  it('passes for an existing material with one location entry', () => {
    const input = values({
      mode: 'existing',
      materialId: 'mat-1',
      entries: [entry('loc-1', 5)],
    })
    expect(inventoryFormSchema.safeParse(input).success).toBe(true)
  })

  it('rejects an entry with no location picked', () => {
    const input = values({
      mode: 'existing',
      materialId: 'mat-1',
      entries: [{ ...createEmptyStockEntry(), quantity: 5 }],
    })
    const error = firstError(input)
    expect(error?.message).toMatch(/pick a location/i)
    expect(error?.path).toEqual(['entries', 0, 'locationId'])
  })

  it('rejects the same location picked twice', () => {
    const input = values({
      mode: 'existing',
      materialId: 'mat-1',
      entries: [entry('loc-1', 5), entry('loc-1', 3)],
    })
    const error = firstError(input)
    expect(error?.message).toMatch(/only be added once/i)
    expect(error?.path).toEqual(['entries', 1, 'locationId'])
  })

  it('rejects a new material with no name', () => {
    const input = values({
      mode: 'new',
      name: '  ',
      entries: [entry('loc-1', 5)],
    })
    expect(firstError(input)?.message).toMatch(/enter a material name/i)
  })
})
