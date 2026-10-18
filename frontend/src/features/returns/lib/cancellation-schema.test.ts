import { describe, expect, it } from 'vitest'
import { CANCELLATION } from '../test-fixtures'
import {
  cancellationSchema,
  createCancellationForm,
} from './cancellation-schema'

describe('cancellation rules', () => {
  it('requires full credit before production and a refund method when the credit exceeds debt', () => {
    const values = {
      ...createCancellationForm(),
      reason: 'Customer changed plans',
    }
    expect(cancellationSchema(CANCELLATION).safeParse(values).success).toBe(
      false,
    )
    values.refundMethod = 'cash'
    expect(cancellationSchema(CANCELLATION).safeParse(values).success).toBe(
      true,
    )
    values.retainedCharge = 1
    expect(cancellationSchema(CANCELLATION).safeParse(values).success).toBe(
      false,
    )
  })

  it('requires explicit agreement for a retained charge once production starts', () => {
    const context = {
      ...CANCELLATION,
      order: { ...CANCELLATION.order, productionStarted: true },
    }
    const values = {
      ...createCancellationForm(),
      reason: 'Customer changed plans',
      retainedCharge: 25,
    }
    expect(cancellationSchema(context).safeParse(values).success).toBe(false)
    values.workChargeConfirmed = true
    expect(cancellationSchema(context).safeParse(values).success).toBe(true)
    for (const amount of [90.01, -1, 1.001, Infinity]) {
      values.retainedCharge = amount
      expect(cancellationSchema(context).safeParse(values).success).toBe(false)
    }
  })

  it('restores only confirmed unused fabric at a known original stock location', () => {
    const values = {
      ...createCancellationForm(),
      reason: 'Cancelled',
      refundTiming: 'later' as const,
      restoredMaterialQuantity: 3.5,
    }
    expect(cancellationSchema(CANCELLATION).safeParse(values).success).toBe(
      false,
    )
    values.unusedMaterialConfirmed = true
    expect(cancellationSchema(CANCELLATION).safeParse(values).success).toBe(
      true,
    )
    expect(
      cancellationSchema({
        ...CANCELLATION,
        order: { ...CANCELLATION.order, canRestoreMaterial: false },
      }).safeParse(values).success,
    ).toBe(false)
    values.restoredMaterialQuantity = 3.51
    expect(cancellationSchema(CANCELLATION).safeParse(values).success).toBe(
      false,
    )
  })
})
