import { describe, expect, it } from 'vitest'
import { giftCardFormSchema } from './gift-card-schema'
import { createEmptyGiftCardForm } from '../types/gift-card-form'
import type { GiftCardFormValues } from '../types/gift-card-form'

function values(
  overrides: Partial<GiftCardFormValues> = {},
): GiftCardFormValues {
  return {
    ...createEmptyGiftCardForm(),
    code: 'GC-ABC123',
    amount: 200,
    ...overrides,
  }
}

function firstError(input: GiftCardFormValues) {
  const result = giftCardFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('giftCardFormSchema', () => {
  it('accepts a card with no customer and no expiry', () => {
    expect(firstError(values())).toBeNull()
  })

  it('requires a code', () => {
    const error = firstError(values({ code: '   ' }))
    expect(error?.message).toMatch(/enter a gift card code/i)
    expect(error?.path).toEqual(['code'])
  })

  it('requires an amount', () => {
    const error = firstError(values({ amount: '' }))
    expect(error?.message).toMatch(/enter an amount/i)
    expect(error?.path).toEqual(['amount'])
  })

  it('rejects a zero or negative amount', () => {
    for (const amount of [0, -50]) {
      const error = firstError(values({ amount }))
      expect(error?.message).toMatch(/greater than 0/i)
      expect(error?.path).toEqual(['amount'])
    }
  })
})
