import { describe, expect, it } from 'vitest'
import { locationFormSchema } from './location-schema'
import { createEmptyLocationForm } from '../types/location-form'
import type { LocationFormValues } from '../types/location-form'

function values(overrides: Partial<LocationFormValues>): LocationFormValues {
  return { ...createEmptyLocationForm(), ...overrides }
}

function firstError(input: LocationFormValues) {
  const result = locationFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('locationFormSchema', () => {
  it('accepts a location that only receives orders', () => {
    const error = firstError(
      values({
        name: 'Downtown Branch',
        receivesOrders: true,
        holdsStock: false,
      }),
    )
    expect(error).toBeNull()
  })

  it('accepts a location that only holds stock', () => {
    const error = firstError(
      values({
        name: 'Main Warehouse',
        receivesOrders: false,
        holdsStock: true,
      }),
    )
    expect(error).toBeNull()
  })

  it('requires a name', () => {
    const error = firstError(values({ name: '   ' }))
    expect(error?.message).toMatch(/enter a location name/i)
    expect(error?.path).toEqual(['name'])
  })

  it('requires at least one capability', () => {
    const error = firstError(
      values({ name: 'Nowhere', receivesOrders: false, holdsStock: false }),
    )
    expect(error?.message).toMatch(/at least one/i)
    expect(error?.path).toEqual(['receivesOrders'])
  })
})
