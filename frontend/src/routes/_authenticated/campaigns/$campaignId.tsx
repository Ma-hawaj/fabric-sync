import { createFileRoute } from '@tanstack/react-router'
import { CampaignDetailPage } from '@/features/campaigns/campaign-detail'

export const Route = createFileRoute('/_authenticated/campaigns/$campaignId')({
  staticData: { title: 'Review campaign' },
  component: CampaignDetail,
})
function CampaignDetail() {
  const { campaignId } = Route.useParams()
  return <CampaignDetailPage key={campaignId} id={campaignId} />
}
