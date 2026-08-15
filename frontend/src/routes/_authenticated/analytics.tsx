import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '@/features/analytics/analytics'

export const Route = createFileRoute('/_authenticated/analytics')({
  staticData: { title: 'Analytics' },
  component: AnalyticsPage,
})
