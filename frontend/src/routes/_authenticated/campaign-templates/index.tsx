import { createFileRoute } from '@tanstack/react-router'
import { MarketingTemplatesPage } from '@/features/campaigns/templates'

export const Route = createFileRoute('/_authenticated/campaign-templates/')({
  staticData: { title: 'Marketing templates' },
  component: MarketingTemplatesPage,
})
