import { createFileRoute } from '@tanstack/react-router'
import { InvoiceDetailPage } from '@/features/invoices/invoice-detail'

export const Route = createFileRoute('/_authenticated/invoices/$invoiceId/')({
  staticData: { title: 'Invoice Details' },
  component: InvoiceDetailRoute,
})

function InvoiceDetailRoute() {
  const { invoiceId } = Route.useParams()
  return <InvoiceDetailPage invoiceId={invoiceId} />
}
