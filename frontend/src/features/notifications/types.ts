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
