import * as React from 'react'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getCustomerColumns } from './components/customer-columns'
import { CustomerDetailsSheet } from './components/customer-details-sheet'
import { useCustomers } from './hooks/use-customers'
import type { Customer } from './types/customers'

export function CustomersPage() {
  const { data: customers = [], isLoading } = useCustomers()
  const [selectedCustomer, setSelectedCustomer] =
    React.useState<Customer | null>(null)

  const columns = React.useMemo(
    () => getCustomerColumns(setSelectedCustomer),
    [],
  )

  const { table } = useDataTable({
    data: customers,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">
          View all registered customers and inspect their measurement histories.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading customers...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <CustomerDetailsSheet
        customer={selectedCustomer}
        allCustomers={customers}
        onOpenChange={(open) => !open && setSelectedCustomer(null)}
      />
    </div>
  )
}
