// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface GiftCardFormValues {
  boughtFor: string
  recipientPhone: string
  amount: NumberInput
  customerId: string
  // ISO date, or blank for a card that never expires.
  expiresOn: string
}

export function createEmptyGiftCardForm(): GiftCardFormValues {
  return {
    boughtFor: '',
    recipientPhone: '',
    amount: '',
    customerId: '',
    expiresOn: '',
  }
}
