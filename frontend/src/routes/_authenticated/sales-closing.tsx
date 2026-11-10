import { createFileRoute } from '@tanstack/react-router'
import { SalesClosingPage } from '@/features/reports/sales-closing'

export const Route = createFileRoute('/_authenticated/sales-closing')({
  staticData: { title: 'Branch closing' },
  component: SalesClosingPage,
})
