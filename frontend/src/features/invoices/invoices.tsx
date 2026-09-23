import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getInvoiceColumns } from './components/invoice-columns'
import { ReceiveInvoiceDialog } from './components/receive-invoice-dialog'
import { useListParams } from '@/hooks/use-list-params'
import { useInvoices } from './hooks/use-invoices'
import { useMaterials } from './hooks/use-materials'
import { printInvoiceDocument } from './lib/print-invoice'
import type { Invoice } from './types/invoices'

export function InvoicesPage() {
  const [selectedInvoice, setSelectedInvoice] = React.useState<Invoice | null>(
    null,
  )
  const navigate = useNavigate()

  const exportPdf = React.useCallback((invoice: Invoice) => {
    toast.promise(printInvoiceDocument(invoice.id), {
      loading: 'Preparing the invoice...',
      success: 'Invoice ready — choose "Save as PDF" to download it.',
      error: 'Could not prepare this invoice. Please try again.',
    })
  }, [])

  // The materials filter offers every material, from its own query. Deriving
  // the options from the invoices on screen would, under server-side paging,
  // offer only the ones the current page happens to mention.
  const { data: materials } = useMaterials()
  const columns = React.useMemo(() => {
    const names = [
      ...new Set(materials.map((material) => material.name)),
    ].sort()
    return getInvoiceColumns(
      names.map((name) => ({ label: name, value: name })),
      setSelectedInvoice,
      (invoice) =>
        void navigate({
          to: '/invoices/$invoiceId',
          params: { invoiceId: invoice.id },
        }),
      exportPdf,
    )
  }, [materials, exportPdf, navigate])

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
  })

  return (
    <div className="space-y-4">
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
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <ReceiveInvoiceDialog
        invoice={selectedInvoice}
        onOpenChange={(open) => !open && setSelectedInvoice(null)}
      />
    </div>
  )
}
