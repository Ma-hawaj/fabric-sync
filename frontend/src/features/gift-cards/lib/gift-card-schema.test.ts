import { describe, expect, it } from 'vitest'
import { giftCardFormSchema } from './gift-card-schema'
import { createEmptyGiftCardForm } from '../types/gift-card-form'
import type { GiftCardFormValues } from '../types/gift-card-form'

function values(
  overrides: Partial<GiftCardFormValues> = {},
): GiftCardFormValues {
  return {
    ...createEmptyGiftCardForm(),
    recipientPhone: '+97333112233',
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

  it('requires a recipient phone number', () => {
    const error = firstError(values({ recipientPhone: '   ' }))
    expect(error?.message).toMatch(/valid recipient phone/i)
    expect(error?.path).toEqual(['recipientPhone'])
  })

  it('requires an amount', () => {
    const error = firstError(values({ amount: '' }))
    expect(error?.message).toMatch(/enter an amount/i)
    expect(error?.path).toEqual(['amount'])
  })

  it('rejects an invalid recipient number while allowing a number without a name', () => {
    for (const recipientPhone of ['123', 'not a phone']) {
      expect(firstError(values({ recipientPhone }))?.path).toEqual([
        'recipientPhone',
      ])
    }
    expect(firstError(values({ boughtFor: '' }))).toBeNull()
  })

  it('rejects a zero or negative amount', () => {
    for (const amount of [0, -50]) {
      const error = firstError(values({ amount }))
      expect(error?.message).toMatch(/greater than 0/i)
      expect(error?.path).toEqual(['amount'])
    }
  })
})
