import { createFileRoute } from '@tanstack/react-router'
import { InvoiceEditPage } from '@/features/invoices/invoice-edit'

export const Route = createFileRoute(
  '/_authenticated/invoices/$invoiceId/edit',
)({
  staticData: { title: 'Edit Invoice' },
  component: InvoiceEditRoute,
})

function InvoiceEditRoute() {
  const { invoiceId } = Route.useParams()
  return <InvoiceEditPage invoiceId={invoiceId} />
}
