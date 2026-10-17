export interface Settlement {
  amountPaid: number
  amountCredited: number
  cashRefunded: number
  giftCardRefunded: number
  netTotal: number
  netAmountPaid: number
  netGiftCardRedeemed: number
  balanceDue: number
  refundDue: number
  paymentStatus: string
}

export interface ReturnableLine {
  lineId: string
  kind: 'order' | 'product'
  description: string
  quantity: number
  returnedQuantity: number
  creditedAmount: number
  lineTotal: number
  creditLimit: number
  collected: boolean
  canRestock: boolean
}

export interface ReturnContext {
  settlement: Settlement
  lines: ReturnableLine[]
  returns: {
    id: string
    reason: string
    amount: number
    createdAt: string
    createdBy: string
    lines: {
      description: string
      quantity: number
      amount: number
      restocked: boolean
    }[]
  }[]
  refunds: {
    id: string
    reason: string
    amount: number
    paymentType: string
    giftCardCode: string | null
    createdAt: string
    createdBy: string
  }[]
  giftCards: { id: string; code: string; refundableAmount: number }[]
}

export interface CreateReturnInput {
  reason: string
  lines: { lineId: string; quantity: number; restock: boolean }[]
}

export interface CreateRefundInput {
  reason: string
  amount: number
  paymentType: 'cash' | 'card' | 'benefit' | 'gift_card'
  giftCardId: string | null
}
