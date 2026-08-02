import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { toast } from 'sonner'
import { getInvoiceColumns } from './components/invoice-columns'
import { InvoiceDetailsSheet } from './components/invoice-details-sheet'
import { ReceiveInvoiceDialog } from './components/receive-invoice-dialog'
import { useInvoices } from './hooks/use-invoices'
import { printInvoiceDocument } from './lib/print-invoice'
import type { Invoice } from './types/invoices'

export function InvoicesPage() {
  const { data: invoices = [], isLoading } = useInvoices()
  const [selectedInvoice, setSelectedInvoice] = React.useState<Invoice | null>(
    null,
  )
  const [viewedInvoice, setViewedInvoice] = React.useState<Invoice | null>(null)

  const exportPdf = React.useCallback((invoice: Invoice) => {
    toast.promise(printInvoiceDocument(invoice.id), {
      loading: 'Preparing the invoice...',
      success: 'Invoice ready — choose "Save as PDF" to download it.',
      error: 'Could not prepare this invoice. Please try again.',
    })
  }, [])

  // The materials filter offers exactly the material names present in the
  // fetched invoices.
  const columns = React.useMemo(() => {
    const materials = [...new Set(invoices.flatMap((i) => i.materials))].sort()
    return getInvoiceColumns(
      materials.map((m) => ({ label: m, value: m })),
      setSelectedInvoice,
      setViewedInvoice,
      exportPdf,
    )
  }, [invoices, exportPdf])

  const { table } = useDataTable({
    data: invoices,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
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
        <LoadingIndicator label="Loading invoices..." />
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <ReceiveInvoiceDialog
        invoice={selectedInvoice}
        onOpenChange={(open) => !open && setSelectedInvoice(null)}
      />

      <InvoiceDetailsSheet
        invoice={viewedInvoice}
        onOpenChange={(open) => !open && setViewedInvoice(null)}
      />
    </div>
  )
}
