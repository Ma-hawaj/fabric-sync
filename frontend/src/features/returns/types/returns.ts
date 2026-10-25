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
  kind: 'order' | 'product' | 'material'
  description: string
  unit?: string | null
  quantity: number
  returnedQuantity: number
  creditedAmount: number
  lineTotal: number
  creditLimit: number
  collected: boolean
  canRestock: boolean
  originalLocationId: string | null
  originalLocationName: string | null
  defaultRestockLocationId: string | null
  outcome: 'active' | 'cancelled' | 'returned'
}

export interface ReturnContext {
  settlement: Settlement
  lines: ReturnableLine[]
  returns: {
    id: string
    reason: string
    kind: 'return' | 'cancellation'
    amount: number
    createdAt: string
    createdBy: string
    lines: {
      lineId: string
      description: string
      quantity: number
      amount: number
      restocked: boolean
      originalLocationId: string | null
      originalLocationName: string | null
      restockLocationId: string | null
      restockLocationName: string | null
    }[]
  }[]
  refunds: {
    id: string
    reason: string
    amount: number
    paymentType: string
    giftCardCode: string | null
    adjustmentId: string | null
    createdAt: string
    createdBy: string
  }[]
  giftCards: { id: string; code: string; refundableAmount: number }[]
}

export interface CreateReturnInput {
  reason: string
  lines: {
    lineId: string
    quantity: number
    restock: boolean
    restockLocationId?: string | null
  }[]
  refund: RefundPlan
}

export interface CreateRefundInput {
  reason: string
  amount: number
  paymentType: 'cash' | 'card' | 'benefit' | 'gift_card'
  giftCardId: string | null
}

export type RefundPlan =
  | { timing: 'later' }
  | { timing: 'now'; payments: Omit<CreateRefundInput, 'reason'>[] }

export interface CancellationDetails {
  orderId: string
  invoiceId: string
  status: 'pending' | 'ready' | 'collected'
  outcome: 'active' | 'cancelled' | 'returned'
  productionStarted: boolean
  materialSource: 'shop' | 'customer'
  materialAmount: number
  canRestoreMaterial: boolean
  stockLocation: string | null
}

export interface CancellationContext {
  order: CancellationDetails
  invoice: ReturnContext
}

export interface CreateCancellationInput {
  reason: string
  retainedCharge: number
  restoredMaterialQuantity: number
  workChargeConfirmed: boolean
  unusedMaterialConfirmed: boolean
  refund: RefundPlan
}
