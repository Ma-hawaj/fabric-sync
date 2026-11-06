import { createFileRoute } from '@tanstack/react-router'
import { GiftCardDetailPage } from '@/features/gift-cards/gift-card-detail'

export const Route = createFileRoute('/_authenticated/gift-cards/$code')({
  staticData: { title: 'Gift Card' },
  component: GiftCardDetailRoute,
})

function GiftCardDetailRoute() {
  const { code } = Route.useParams()
  return <GiftCardDetailPage key={code} code={code} />
}
