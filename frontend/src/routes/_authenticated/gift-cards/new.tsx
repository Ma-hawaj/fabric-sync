import { createFileRoute } from '@tanstack/react-router'
import { GiftCardFormPage } from '@/features/gift-cards/gift-card-form'

export const Route = createFileRoute('/_authenticated/gift-cards/new')({
  staticData: { title: 'Issue Gift Card' },
  component: GiftCardFormPage,
})
