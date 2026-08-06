import { createFileRoute } from '@tanstack/react-router'
import { MarketingCampaignsPage } from '@/features/marketing/marketing'

export const Route = createFileRoute('/_authenticated/marketing/')({
  staticData: { title: 'Marketing' },
  component: MarketingCampaignsPage,
})
