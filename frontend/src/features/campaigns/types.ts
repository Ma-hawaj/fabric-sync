export interface AudienceCount {
  messageCount: number
  matchingCustomers: number
  excludedCustomers: number
}
export interface AudienceFilter {
  lastPurchaseFrom?: string | null
  lastPurchaseTo?: string | null
  neverPurchased: boolean
  minPurchases?: number | null
  maxPurchases?: number | null
  minSpend?: string | null
  maxSpend?: string | null
  branchId?: string | null
  excludedCustomerIds: string[]
}
export interface TemplateDefinition {
  body: string
  examples: string[]
  footer: string | null
  imageHeader: boolean
  sampleAssetId: string | null
  websiteLabel: string | null
  websiteUrl: string | null
  unsubscribeLabel: string
}
export interface MarketingTemplate {
  id: string
  revision: string
  name: string
  language: string
  definition: TemplateDefinition
  state: string
  providerId: string | null
  rejectionReason: string | null
  archived: boolean
  syncedAt: string | null
}
export interface CampaignInput {
  name: string
  templateId: string
  parameters: string[]
  assetId: string | null
  audience: AudienceFilter
  sendAt: string | null
  expiresAt: string
  expectedRevision?: string
}
export interface AudienceCustomer {
  id: string
  name: string
  mobileNo: string
  purchaseCount: number
  lifetimeSpend: string
  lastPurchase: string | null
}
export interface Destination {
  mobile: string
  customers: AudienceCustomer[]
  excludedReason: string | null
}
export interface CampaignPreview {
  version: string
  revision: string
  template: MarketingTemplate
  body: string
  parameters: string[]
  assetId: string | null
  sendAt: string | null
  expiresAt: string
  destinations: Destination[]
  excluded: Destination[]
}
export interface Campaign {
  id: string
  revision: string
  name: string
  definition: CampaignInput
  state: string
  previewVersion: string | null
  preview: CampaignPreview | null
  approvedBy: string | null
  approvedAt: string | null
  sendAt: string | null
  expiresAt: string | null
  blockedReason: string | null
  createdAt: string
}
export interface Recipient {
  id: string
  mobile: string
  customers: AudienceCustomer[]
  state: string
  error_message: string | null
  unsubscribed_at: string | null
}
export interface RecipientPage {
  items: Recipient[]
  total: number
  counts: Record<string, number>
  unsubscribes: number
}
export interface Capabilities {
  canSend: boolean
  canManageTemplates: boolean
  timezone: string
}
export interface ConsentResponse {
  mobile: string | null
  consent: {
    granted: boolean
    version: string
    observedAt: string
    source: string
    recordedBy: string
  } | null
}
