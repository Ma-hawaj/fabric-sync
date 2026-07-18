import { createFileRoute } from '@tanstack/react-router'
import { InvoiceFormPage } from '@/features/invoices/invoice-form'

export const Route = createFileRoute('/_authenticated/invoices/new')({
  staticData: { title: 'New Invoice' },
  component: InvoiceFormPage,
})
