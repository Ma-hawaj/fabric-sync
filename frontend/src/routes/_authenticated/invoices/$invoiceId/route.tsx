import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/invoices/$invoiceId')({
  component: InvoiceRouteLayout,
})

// Layout only: the detail page (`index.tsx`) and the edit page (`edit.tsx`)
// render through this outlet. A bare `$invoiceId.tsx` leaf would swallow the
// child — TanStack nests `$invoiceId/edit` under it, and with no outlet the
// edit route never renders.
function InvoiceRouteLayout() {
  return <Outlet />
}
