import { describe, expect, it } from 'vitest'
import { productFormSchema } from './product-schema'
import {
  createEmptyProductForm,
  createEmptyProductStockEntry,
} from '../types/product-form'
import type { ProductFormValues } from '../types/product-form'

function values(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    ...createEmptyProductForm(),
    name: 'Silk Scarf',
    unitPrice: 49.5,
    ...overrides,
  }
}

function firstError(input: ProductFormValues) {
  const result = productFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

function entry(locationId: string, quantity: number) {
  return { ...createEmptyProductStockEntry(), locationId, quantity }
}

describe('productFormSchema', () => {
  it('accepts a product with no stock at all', () => {
    expect(firstError(values({ entries: [] }))).toBeNull()
  })

  it('accepts a free product', () => {
    expect(firstError(values({ unitPrice: 0 }))).toBeNull()
  })

  it('requires a name', () => {
    const error = firstError(values({ name: '   ' }))
    expect(error?.message).toMatch(/enter a product name/i)
    expect(error?.path).toEqual(['name'])
  })

  it('requires a price', () => {
    const error = firstError(values({ unitPrice: '' }))
    expect(error?.message).toMatch(/enter a price/i)
    expect(error?.path).toEqual(['unitPrice'])
  })

  it('rejects a negative price', () => {
    const error = firstError(values({ unitPrice: -1 }))
    expect(error?.message).toMatch(/0 or more/i)
    expect(error?.path).toEqual(['unitPrice'])
  })

  it('requires a location on a stock row', () => {
    const error = firstError(values({ entries: [entry('', 5)] }))
    expect(error?.message).toMatch(/pick a location/i)
    expect(error?.path).toEqual(['entries', 0, 'locationId'])
  })

  it('rejects the same location added twice', () => {
    const error = firstError(
      values({ entries: [entry('loc-1', 5), entry('loc-1', 3)] }),
    )
    expect(error?.message).toMatch(/only be added once/i)
    expect(error?.path).toEqual(['entries', 1, 'locationId'])
  })
})
