import { createFileRoute } from '@tanstack/react-router'
import { CampaignsPage } from '@/features/campaigns/campaigns'

export const Route = createFileRoute('/_authenticated/campaigns/')({
  component: CampaignsPage,
})
