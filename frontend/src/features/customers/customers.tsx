import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getCustomerColumns } from './components/customer-columns'
import { CustomerDetailsSheet } from './components/customer-details-sheet'
import { useCustomers } from './hooks/use-customers'
import { useUpdateCustomer } from './hooks/use-update-customer'
import type { Customer } from './types/customers'

export function CustomersPage() {
  const { data: customers = [], isLoading } = useCustomers()
  const [selectedCustomer, setSelectedCustomer] =
    React.useState<Customer | null>(null)
  const updateCustomer = useUpdateCustomer()

  const toggleOptIn = React.useCallback(
    (customer: Customer) => {
      const pending = updateCustomer.mutateAsync({
        id: customer.id,
        marketingOptIn: !customer.marketingOptIn,
      })
      toast.promise(pending, {
        loading: customer.marketingOptIn
          ? `Opting ${customer.name} out...`
          : `Opting ${customer.name} in...`,
        success: (updated) =>
          updated.marketingOptIn
            ? `${updated.name} will now receive marketing messages.`
            : `${updated.name} was opted out of marketing messages.`,
        error: 'Could not update this customer. Please try again.',
      })
    },
    [updateCustomer],
  )

  const columns = React.useMemo(
    () =>
      getCustomerColumns(
        setSelectedCustomer,
        toggleOptIn,
        updateCustomer.isPending,
      ),
    [toggleOptIn, updateCustomer.isPending],
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            View all registered customers and inspect their measurement
            histories.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/customers/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Customer
        </Button>
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
        onOpenChange={(open) => !open && setSelectedCustomer(null)}
      />
    </div>
  )
}
