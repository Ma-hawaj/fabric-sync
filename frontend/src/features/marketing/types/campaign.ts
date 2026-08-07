export interface CampaignRecipient {
  id: string
  customerId: string
  customerName: string
  mobileNo: string
  status: 'pending' | 'sent' | 'failed'
  errorMessage?: string
  sentAt?: string
}

// One row of GET /marketing-messages — a WhatsApp broadcast staff sent (or
// are sending) to a set of opted-in customers.
export interface Campaign {
  id: string
  body: string
  templateName: string
  createdBy?: string
  createdAt: string
  recipients: CampaignRecipient[]
}
