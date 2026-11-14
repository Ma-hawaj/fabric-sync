import { createFileRoute } from '@tanstack/react-router'
import { CampaignFormPage } from '@/features/campaigns/campaign-form'

export const Route = createFileRoute('/_authenticated/campaigns/new')({
  staticData: { title: 'New campaign' },
  component: CampaignFormPage,
})
