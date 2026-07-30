import * as React from 'react'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getOrderColumns } from './components/order-columns'
import { ReceiveOrderDialog } from './components/receive-order-dialog'
import { useAllInventory } from '@/features/inventory/hooks/use-inventory'
import { useListParams } from '@/hooks/use-list-params'
import { useOrders } from './hooks/use-orders'
import type { Order } from './types/orders'

export function OrdersPage() {
  const [selectedOrder, setSelectedOrder] = React.useState<Order | null>(null)

  // The material filter offers every material, from its own query. Deriving the
  // options from the orders on screen would, under server-side paging, offer
  // only the ones the current page happens to mention.
  const { data: materials } = useAllInventory()
  const columns = React.useMemo(() => {
    const names = [
      ...new Set(materials.map((material) => material.name)),
    ].sort()
    return getOrderColumns(
      names.map((name) => ({ label: name, value: name })),
      setSelectedOrder,
    )
  }, [materials])

  const { searchParams } = useListParams({ columns })
  const { data: orders, pageCount, total, isLoading } = useOrders(searchParams)

  const { table } = useDataTable({
    data: orders,
    columns,
    pageCount,
    rowCount: total,
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

      <ReceiveOrderDialog
        order={selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
      />
    </div>
  )
}
