export interface ClosingActivity {
  id: string
  invoiceId: string
  invoiceNumber: number
  occurredAt: string
  kind:
    | 'sale'
    | 'payment'
    | 'credit'
    | 'refund'
    | 'gift_card_redemption'
    | 'repair_payment'
  method: string | null
  amount: number
}

export interface SalesClosing {
  trackingStartDate: string | null
  missedClosing?: {
    id: string
    reason: string
    resolvedAt: string
    resolvedBy: string
  } | null
  readOnly: boolean
  closure: DayClosure | null
  businessDate?: string | null
  previousUnclosedDate?: string | null
  opening: CashOpening | null
  expenses: BranchExpense[]
  unassignedActivityCount: number
  branchId: string
  branchName: string
  fingerprint: string
  date: string
  timezone: string
  generatedAt: string
  summary: {
    unrecordedMethodCount: number
    invoiceCount: number
    invoiceTotal: number
    taxableAmount: number
    vatAmount: number
    giftCardSales: number
    credits: number
    netInvoiceActivity: number
    invoicePayments: number
    repairPayments: number
    externalRefunds: number
    netExternalReceipts: number
    giftCardRedemptions: number
    giftCardRefunds: number
  }
  tenders: {
    method: string
    invoicePayments: number
    repairPayments: number
    refunds: number
    net: number
    expenses: number
    afterExpenses: number
  }[]
  activity: ClosingActivity[]
}

export interface BranchDayStatus {
  dailyCheckRequired: boolean
  dailyCheckChangedAt?: string | null
  dailyCheckChangedBy?: string | null
  trackingStartDate: string | null
  branchId: string
  date: string
  openingRecorded: boolean
  closed: boolean
  previousUnclosedDate: string | null
  canTrade: boolean
  canCreateOrders: boolean
}

export interface CashOpening {
  id: string
  amount: number
  recordedAt: string
  recordedBy: string
  notes: string
  supersedesId: string | null
}

export interface BranchExpense {
  id: string
  amount: number
  paymentType: 'cash' | 'benefit' | 'card'
  reason: string
  paidTo: string
  reference: string
  recordedAt: string
  recordedBy: string
  voidedAt: string | null
  voidReason: string | null
  voidedBy: string | null
}

export interface ClosingCounts {
  branchActivityConfirmed: boolean
  openingCash: number
  cashAdded: number
  cashRemoved: number
  actualCash: number
  actualBenefit: number
  actualCard: number
  notes: string
}

export interface ClosingComparison {
  matched: boolean
  unresolvedMethods: number
  lines: {
    method: string
    recorded: number
    expected: number
    actual: number
    difference: number
  }[]
}

export interface DayClosure {
  id: string
  closedAt: string
  closedBy: string
  counts: ClosingCounts
  comparison: ClosingComparison
}
