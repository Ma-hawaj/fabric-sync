export interface FieldChange {
  path: string
  label: string
  before: string | null
  after: string | null
}

interface HistoryReturnLine {
  lineId: string
  description: string
  quantity: number
  amount: number
  restocked: boolean
  originalLocationId: string | null
  originalLocationName: string | null
  restockLocationId: string | null
  restockLocationName: string | null
}

export type InvoiceHistoryEntry =
  | { kind: 'created'; at: string; actor: string | null }
  | {
      kind: 'edited'
      id: string
      at: string
      actor: string | null
      changes: FieldChange[]
      totalBefore: number | null
      totalAfter: number | null
    }
  | {
      kind: 'payment'
      id: string
      at: string
      actor: string | null
      amount: number
      paymentType: string | null
      orderId: string | null
    }
  | {
      kind: 'collection'
      orderId: string
      orderNumber: number
      at: string
    }
  | {
      kind: 'return'
      id: string
      at: string
      actor: string
      returnKind: string
      reason: string
      amount: number
      lines: HistoryReturnLine[]
    }
  | {
      kind: 'refund'
      id: string
      at: string
      actor: string
      reason: string
      amount: number
      paymentType: string
      giftCardCode: string | null
    }
