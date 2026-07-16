import { createFileRoute } from '@tanstack/react-router'
import { InvoicesPage } from '@/features/invoices/invoices'

export const Route = createFileRoute('/_authenticated/invoices')({
  staticData: { title: 'Invoices' },
  component: InvoicesPage,
})
