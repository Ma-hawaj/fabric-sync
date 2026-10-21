import { NotificationDialog } from '@/features/notifications/notification-dialog'
import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getInvoiceColumns } from './components/invoice-columns'
import { InvoiceOrderBreakdown } from './components/invoice-order-breakdown'
import { CollectInvoiceDialog } from './components/collect-invoice-dialog'
import { RecordPaymentDialog } from './components/record-payment-dialog'
import { useListParams } from '@/hooks/use-list-params'
import { useInvoices } from './hooks/use-invoices'
import { useMaterials } from './hooks/use-materials'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import {
  orderReceivingLocations,
  productionLocations as productionLocationOptions,
} from '@/features/locations/lib/location-filters'
import { downloadInvoicePdf } from './lib/print-invoice'
import type { Invoice } from './types/invoices'

export function InvoicesPage() {
  const [collectInvoice, setCollectInvoice] = React.useState<Invoice | null>(
    null,
  )
  const [paymentInvoice, setPaymentInvoice] = React.useState<Invoice | null>(
    null,
  )
  const navigate = useNavigate()
  const [resendId, setResendId] = React.useState<string | null>(null)

  const exportPdf = React.useCallback((invoice: Invoice) => {
    toast.promise(downloadInvoicePdf(invoice.id), {
      loading: 'Preparing the invoice...',
      success: 'Invoice PDF downloaded.',
      error: 'Could not prepare this invoice. Please try again.',
    })
  }, [])

  // The materials filter offers every material, from its own query. Deriving
  // the options from the invoices on screen would, under server-side paging,
  // offer only the ones the current page happens to mention. Location filters
  // work the same way: receiving branches and production (material stock)
  // locations come from the whole locations list, narrowed by capability.
  const { data: materials } = useMaterials()
  const { data: locations = [] } = useAllLocations()
  const columns = React.useMemo(() => {
    const names = [
      ...new Set([
        'Customer-provided material',
        ...materials.map((material) => material.name),
      ]),
    ].sort()
    const receiving = orderReceivingLocations(locations).map((location) => ({
      label: location.name,
      value: location.name,
    }))
    const production = productionLocationOptions(locations).map((location) => ({
      label: location.name,
      value: location.name,
    }))
    return getInvoiceColumns(
      names.map((name) => ({ label: name, value: name })),
      receiving,
      production,
      setCollectInvoice,
      (invoice) =>
        void navigate({
          to: '/invoices/$invoiceId',
          params: { invoiceId: invoice.id },
        }),
      exportPdf,
      (invoice) =>
        void navigate({
          to: '/invoices/$invoiceId/edit',
          params: { invoiceId: invoice.id },
        }),
      setPaymentInvoice,
      (invoice) => setResendId(invoice.id),
    )
  }, [materials, locations, exportPdf, navigate])

  const { searchParams } = useListParams({ columns })
  const {
    data: invoices,
    pageCount,
    total,
    isLoading,
  } = useInvoices(searchParams)

  const { table } = useDataTable({
    data: invoices,
    columns,
    pageCount,
    rowCount: total,
    getRowId: (invoice) => invoice.id,
    getRowCanExpand: (row) => row.original.orderCount > 0,
    manualExpanding: true,
    initialState: { columnVisibility: { customerMobile: false } },
  })

  return (
    <div className="space-y-4">
      <NotificationDialog
        invoiceId={resendId}
        kind="manual_resend"
        onClose={() => setResendId(null)}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground">
            Manage and view all customer invoices and their details.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/invoices/new" />}>
          <PlusIcon className="h-4 w-4" />
          New Invoice
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground">
          Loading invoices...
        </div>
      ) : (
        <DataTable
          table={table}
          renderExpandedRow={(row) => (
            <InvoiceOrderBreakdown invoiceId={row.original.id} />
          )}
        >
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <CollectInvoiceDialog
        invoice={collectInvoice}
        onOpenChange={(open) => !open && setCollectInvoice(null)}
      />
      <RecordPaymentDialog
        invoice={paymentInvoice}
        onOpenChange={(open) => !open && setPaymentInvoice(null)}
      />
    </div>
  )
}
