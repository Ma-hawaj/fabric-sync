import { createFileRoute } from '@tanstack/react-router'
import { GiftCardsPage } from '@/features/gift-cards/gift-cards'

export const Route = createFileRoute('/_authenticated/gift-cards/')({
  staticData: { title: 'Gift Cards' },
  component: GiftCardsPage,
})
