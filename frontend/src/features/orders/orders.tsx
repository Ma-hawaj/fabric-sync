import * as React from 'react'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getOrderColumns } from './components/order-columns'
import { useOrders } from './hooks/use-orders'

export function OrdersPage() {
  const { data: orders = [], isLoading } = useOrders()

  // The material filter offers exactly the material names present in the
  // fetched orders.
  const columns = React.useMemo(() => {
    const materials = [...new Set(orders.map((o) => o.material))].sort()
    return getOrderColumns(materials.map((m) => ({ label: m, value: m })))
  }, [orders])

  const { table } = useDataTable({
    data: orders,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <p className="text-muted-foreground">
          Manage and view all fabric orders and their details.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground">
          Loading orders...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
