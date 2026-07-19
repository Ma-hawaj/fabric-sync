import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getInvoiceColumns } from './components/invoice-columns'
import { useInvoices } from './hooks/use-invoices'

export function InvoicesPage() {
  const { data: invoices = [], isLoading } = useInvoices()

  // The materials filter offers exactly the material names present in the
  // fetched invoices.
  const columns = React.useMemo(() => {
    const materials = [...new Set(invoices.flatMap((i) => i.materials))].sort()
    return getInvoiceColumns(materials.map((m) => ({ label: m, value: m })))
  }, [invoices])

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
        <div className="text-center text-sm text-muted-foreground">
          Loading invoices...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
