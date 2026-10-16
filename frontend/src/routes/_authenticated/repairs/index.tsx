import { createFileRoute } from '@tanstack/react-router'
import { RepairsPage } from '@/features/orders/repairs'

export const Route = createFileRoute('/_authenticated/repairs/')({
  staticData: { title: 'Repairs' },
  component: RepairsPage,
})
