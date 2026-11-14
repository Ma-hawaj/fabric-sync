export type NotificationKind =
  'invoice_created' | 'invoice_updated' | 'invoice_ready' | 'manual_resend'
export interface NotificationSelectionInput {
  id: string
  previewVersion: string
  selectedMobiles: string[]
}
export interface NotificationCustomer {
  id: string
  name: string
  mobileNo: string
  enabled: boolean
}
export interface Recipient {
  id: string
  normalizedMobile: string
  customers: NotificationCustomer[]
  selected: boolean
  status: string
  errorMessage: string | null
}
export interface NotificationDraft {
  id: string
  invoiceId: string
  kind: NotificationKind
  state: string
  previewVersion: string
  artifactId: string | null
  canSend: boolean
  snapshot: {
    repairId?: string | null
    invoiceNumber: number
    body: string
    language: string
    exclusions: {
      mobile: string
      customers: NotificationCustomer[]
      excludedReason: string
    }[]
  }
  recipients: Recipient[]
}
export interface NotificationHistoryRow {
  id: string
  repairId?: string | null
  kind: NotificationKind
  state: string
  createdAt: string
  sendCount: number
  recipientCount: number
  queuedCount: number
  acceptedCount: number
  deliveredCount: number
  failedCount: number
  uncertainCount: number
  cancelledCount: number
}

export type AttentionStatus =
  | 'not_sent'
  | 'failed'
  | 'uncertain'
  | 'delayed'
  | 'queued'
  | 'accepted'
  | 'delivered'

export interface NotificationAttentionRow {
  entityId: string
  reference: string
  invoiceId: string | null
  invoiceNumber: number | null
  giftCardId: string | null
  giftCardCode: string | null
  repairId: string | null
  orderId: string | null
  repairReason: string | null
  branchName: string | null
  customers: { id: string; name: string; mobileNo: string }[]
  kind: 'invoice' | 'invoice_ready' | 'repair_ready' | 'gift_card'
  status: AttentionStatus
  eligible: boolean
  needsAttention: boolean
  waitingSince: string
  lastAttemptAt: string | null
  notificationId: string | null
  recipientCount: number
  queuedCount: number
  acceptedCount: number
  deliveredCount: number
  failedCount: number
  uncertainCount: number
  cancelledCount: number
  recipients: Recipient[]
  errorMessage: string | null
  previousVersion: {
    status: AttentionStatus
    recipients: Recipient[]
    errorMessage: string | null
  } | null
}

export interface NotificationAttentionSummary {
  total: number
  notSent: number
  failed: number
  uncertain: number
  delayed: number
}
