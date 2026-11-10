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
  policy?: ClosingPolicy | null
  missedClosing?: {
    id: string
    reason: string
    resolvedAt: string
    resolvedBy: string
  } | null
  readOnly?: boolean
  closure?: {
    id: string
    checkId: string
    closedAt: string
    closedBy: string
  } | null
  businessDate?: string | null
  previousUnclosedDate?: string | null
  opening: CashOpening | null
  expenses: BranchExpense[]
  unassignedActivityCount: number
  branchId: string
  branchName: string
  fingerprint: string
  lastCheck: ClosingCheck | null
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
  controlsStartDate?: string | null
  setupRequired?: boolean
  branchId: string
  date: string
  openingRecorded: boolean
  closed: boolean
  previousUnclosedDate: string | null
  canCreateOrders: boolean
}

export interface ClosingPolicy {
  startsOn: string
  configuredAt: string
  configuredBy: string
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

export interface ClosingCheck {
  id: string
  checkedAt: string
  fingerprint: string
  counts: ClosingCounts
  comparison: ClosingComparison
}
