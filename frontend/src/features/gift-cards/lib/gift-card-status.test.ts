import { describe, expect, it } from 'vitest'
import { giftCardStatus } from './gift-card-status'
import type { GiftCard } from '../types/gift-card'

function card(overrides: Partial<GiftCard> = {}): GiftCard {
  return {
    id: 'gc-1',
    code: 'GC-ABC123',
    initialAmount: 500,
    balance: 500,
    customerId: null,
    customerName: null,
    expiresOn: null,
    isActive: true,
    ...overrides,
  }
}

describe('giftCardStatus', () => {
  it('is active for a card with a balance and no expiry', () => {
    expect(giftCardStatus(card(), '2026-07-28')).toBe('Active')
  })

  it('is spent once the balance reaches zero', () => {
    expect(giftCardStatus(card({ balance: 0 }), '2026-07-28')).toBe('Spent')
  })

  it('is voided regardless of the balance left on it', () => {
    expect(giftCardStatus(card({ isActive: false }), '2026-07-28')).toBe(
      'Voided',
    )
  })

  it('is still active on the expiry date itself', () => {
    expect(
      giftCardStatus(card({ expiresOn: '2026-07-28' }), '2026-07-28'),
    ).toBe('Active')
  })

  it('is expired the day after', () => {
    expect(
      giftCardStatus(card({ expiresOn: '2026-07-28' }), '2026-07-29'),
    ).toBe('Expired')
  })

  it('reports voided ahead of expired when both apply', () => {
    expect(
      giftCardStatus(
        card({ isActive: false, expiresOn: '2026-01-01' }),
        '2026-07-28',
      ),
    ).toBe('Voided')
  })
})
