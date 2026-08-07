import { createFileRoute } from '@tanstack/react-router'
import { MarketingCampaignFormPage } from '@/features/marketing/marketing-campaign-form'

export const Route = createFileRoute('/_authenticated/marketing/new')({
  staticData: { title: 'New Marketing Message' },
  component: MarketingCampaignFormPage,
})
