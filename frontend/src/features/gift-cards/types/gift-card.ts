// Shape of GET /gift-cards. A card is stored value: `balance` is what is left
// to spend and is decremented across invoices, so it outlives the sale that
// created it.
export interface GiftCard {
  id: string
  code: string
  initialAmount: number
  balance: number
  customerId: string | null
  customerName: string | null
  expiresOn: string | null
  isActive: boolean
}
