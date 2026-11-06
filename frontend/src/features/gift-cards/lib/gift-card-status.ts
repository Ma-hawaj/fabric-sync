import type { GiftCard } from '../types/gift-card'

// The single place the "can this card be spent?" rule lives, mirroring
// check_redeemable in the Rust service. Replacement, voiding, expiry, and a
// depleted balance read better as one status than separate columns — the
// gift cards list and the invoice form's redemption row both use it.
export type GiftCardStatus =
  'Active' | 'Spent' | 'Expired' | 'Voided' | 'Replaced'

/** `on` is the invoice date rather than today, matching the backend. */
export function giftCardStatus(card: GiftCard, on: string): GiftCardStatus {
  if (card.replacedByCardId) return 'Replaced'
  if (!card.isActive) return 'Voided'
  if (card.balance <= 0) return 'Spent'
  if (card.expiresOn !== null && card.expiresOn < on) return 'Expired'
  return 'Active'
}

/** Expired uninvoiced credit can be renewed; voided, spent, and retired codes cannot. */
export function canReplaceGiftCard(card: GiftCard, on: string): boolean {
  const status = giftCardStatus(card, on)
  return status === 'Active' || (status === 'Expired' && !card.taxedAtIssue)
}
