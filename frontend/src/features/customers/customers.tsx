import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { getCustomerColumns } from './components/customer-columns'
import { CustomerDetailsSheet } from './components/customer-details-sheet'
import { useCustomers } from './hooks/use-customers'
import { printMeasurements } from './lib/print-measurements'
import type { Customer } from './types/customers'

export function CustomersPage() {
  const [selectedCustomer, setSelectedCustomer] =
    React.useState<Customer | null>(null)

  const printCustomer = React.useCallback((customer: Customer) => {
    const measurement = customer.measurements[0]
    const pending = printMeasurements(customer, measurement)
    toast.promise(pending, {
      loading: 'Preparing measurements...',
      success: 'Print dialog opened.',
      error: 'Failed to generate measurement document.',
    })
    void pending
  }, [])

  const columns = React.useMemo(
    () => getCustomerColumns(setSelectedCustomer, printCustomer),
    [printCustomer],
  )

  const { searchParams } = useListParams({ columns })
  const {
    data: customers,
    pageCount,
    total,
    isLoading,
  } = useCustomers(searchParams)

  const { table } = useDataTable({
    data: customers,
    columns,
    pageCount,
    rowCount: total,
    enableAdvancedFilter: true,
  })

  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-3 [&>:first-child]:shrink-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Customers{' '}
            <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
              {isLoading ? '…' : total.toLocaleString()} records
            </span>
          </h1>
          <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            Contacts, measurements and invoice history.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/customers/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Customer
        </Button>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar table={table} />
      </DataTable>

      <CustomerDetailsSheet
        customer={selectedCustomer}
        onOpenChange={(open) => !open && setSelectedCustomer(null)}
      />
    </div>
  )
}
