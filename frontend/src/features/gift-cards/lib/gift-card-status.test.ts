import { describe, expect, it } from 'vitest'
import { canReplaceGiftCard, giftCardStatus } from './gift-card-status'
import type { GiftCard } from '../types/gift-card'

function card(overrides: Partial<GiftCard> = {}): GiftCard {
  return {
    issuedBy: null,
    taxedAtIssue: false,
    replacesCardId: null,
    replacesCardCode: null,
    replacedByCardId: null,
    replacedByCardCode: null,
    id: 'gc-1',
    code: 'GC-ABC123',
    initialAmount: 500,
    balance: 500,
    customerId: null,
    customerName: null,
    boughtFor: null,
    recipientPhone: null,
    deliveryStatus: null,
    deliveryError: null,
    expiresOn: null,
    isActive: true,
    ...overrides,
  }
}

describe('giftCardStatus', () => {
  it.each([false, true])(
    'allows expired cards with taxedAtIssue=%s to renew only with a usable balance',
    (taxedAtIssue) => {
      const expired = card({ expiresOn: '2000-01-01', taxedAtIssue })
      expect(canReplaceGiftCard(expired, '2026-11-06')).toBe(true)
      expect(
        canReplaceGiftCard({ ...expired, isActive: false }, '2026-11-06'),
      ).toBe(false)
      expect(canReplaceGiftCard({ ...expired, balance: 0 }, '2026-11-06')).toBe(
        false,
      )
      expect(
        canReplaceGiftCard(
          { ...expired, replacedByCardId: 'replacement' },
          '2026-11-06',
        ),
      ).toBe(false)
    },
  )
  it('reports replaced ahead of voided or spent for an old code', () => {
    expect(
      giftCardStatus(
        card({ isActive: false, balance: 0, replacedByCardId: 'new-card' }),
        '2026-11-05',
      ),
    ).toBe('Replaced')
  })
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
