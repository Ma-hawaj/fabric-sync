import type { GiftCard } from '../types/gift-card'

// The single place the "can this card be spent?" rule lives, mirroring
// check_redeemable in the Rust service. A card can be unusable for three
// separate reasons, which read better as one status than three columns — the
// gift cards list and the invoice form's redemption row both use it.
export type GiftCardStatus = 'Active' | 'Spent' | 'Expired' | 'Voided'

/** `on` is the invoice date rather than today, matching the backend. */
export function giftCardStatus(card: GiftCard, on: string): GiftCardStatus {
  if (!card.isActive) return 'Voided'
  if (card.balance <= 0) return 'Spent'
  if (card.expiresOn !== null && card.expiresOn < on) return 'Expired'
  return 'Active'
}
