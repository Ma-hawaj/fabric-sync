import { describe, expect, it } from 'vitest'
import {
  createEmptyRecordPaymentForm,
  recordPaymentSchema,
} from './record-payment-schema'
import type { RecordPaymentFormValues } from './record-payment-schema'

const BALANCE = 240

function values(
  overrides: Partial<RecordPaymentFormValues>,
): RecordPaymentFormValues {
  return { ...createEmptyRecordPaymentForm(), ...overrides }
}

function firstError(input: RecordPaymentFormValues) {
  const result = recordPaymentSchema(BALANCE).safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('recordPaymentSchema', () => {
  it('passes for a partial payment with a method', () => {
    const input = values({ amount: 100, paymentType: 'cash' })
    expect(recordPaymentSchema(BALANCE).safeParse(input).success).toBe(true)
  })

  it('passes for the full remaining balance', () => {
    const input = values({ amount: BALANCE, paymentType: 'card' })
    expect(recordPaymentSchema(BALANCE).safeParse(input).success).toBe(true)
  })

  it('rejects a missing amount', () => {
    const error = firstError(values({ paymentType: 'cash' }))
    expect(error?.message).toMatch(/enter an amount/i)
    expect(error?.path).toEqual(['amount'])
  })

  it('rejects a non-positive amount', () => {
    const error = firstError(values({ amount: 0, paymentType: 'cash' }))
    expect(error?.message).toMatch(/greater than zero/i)
    expect(error?.path).toEqual(['amount'])
  })

  it('rejects more than the remaining balance', () => {
    const error = firstError(
      values({ amount: BALANCE + 0.01, paymentType: 'cash' }),
    )
    expect(error?.message).toMatch(/remaining balance/i)
    expect(error?.path).toEqual(['amount'])
  })

  it('rejects a missing payment method', () => {
    const error = firstError(values({ amount: 100 }))
    expect(error?.message).toMatch(/pick a payment method/i)
    expect(error?.path).toEqual(['paymentType'])
  })
})
