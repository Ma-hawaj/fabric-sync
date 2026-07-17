import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { invoiceColumns } from './components/invoice-columns'
import { useInvoices } from './hooks/use-invoices'

export function InvoicesPage() {
  const { data: invoices = [], isLoading } = useInvoices()

  const { table } = useDataTable({
    data: invoices,
    columns: invoiceColumns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground">
          Manage and view all customer invoices and their details.
        </p>
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
