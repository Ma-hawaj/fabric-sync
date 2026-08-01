import { describe, expect, it } from 'vitest'
import { orderStageFormSchema } from './order-stage-schema'
import { createEmptyOrderStageForm } from '../types/order-stage-form'
import type { OrderStageFormValues } from '../types/order-stage-form'

function values(
  overrides: Partial<OrderStageFormValues>,
): OrderStageFormValues {
  return { ...createEmptyOrderStageForm(), ...overrides }
}

function firstError(input: OrderStageFormValues) {
  const result = orderStageFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('orderStageFormSchema', () => {
  it('accepts an ordinary stage', () => {
    expect(firstError(values({ name: 'Cutting', sortOrder: 1 }))).toBeNull()
  })

  it('accepts a stage that only applies to deliveries', () => {
    expect(
      firstError(
        values({
          name: 'Location delivery',
          sortOrder: 4,
          requiresDelivery: true,
        }),
      ),
    ).toBeNull()
  })

  it('requires a name', () => {
    const error = firstError(values({ name: '   ', sortOrder: 1 }))
    expect(error?.message).toMatch(/enter a stage name/i)
    expect(error?.path).toEqual(['name'])
  })

  it('requires a position', () => {
    const error = firstError(values({ name: 'Pressing', sortOrder: '' }))
    expect(error?.message).toMatch(/enter a position/i)
    expect(error?.path).toEqual(['sortOrder'])
  })

  it('rejects a position below one', () => {
    const error = firstError(values({ name: 'Pressing', sortOrder: 0 }))
    expect(error?.message).toMatch(/1 or more/i)
    expect(error?.path).toEqual(['sortOrder'])
  })
})
