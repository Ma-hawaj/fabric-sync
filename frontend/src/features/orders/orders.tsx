import * as React from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getOrderColumns } from './components/order-columns'
import { LogRepairDialog } from './components/log-repair-dialog'
import { OrderTrackingSheet } from './components/order-tracking-sheet'
import { ReceiveOrderDialog } from './components/receive-order-dialog'
import { useOrders } from './hooks/use-orders'
import { stageFilterOptions } from './lib/order-tracking'
import type { Order } from './types/orders'

const routeApi = getRouteApi('/_authenticated/orders')

export function OrdersPage() {
  const { data: orders = [], isLoading } = useOrders()
  const [selectedOrder, setSelectedOrder] = React.useState<Order | null>(null)
  // Synced to the URL's trackOrderId search param (rather than plain state)
  // so a link from elsewhere — the invoice details sheet's tailoring lines —
  // can open this order's tracking sheet directly.
  const { trackOrderId } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  const setTrackedOrderId = (orderId: string | null) =>
    navigate({
      search: (prev) => ({ ...prev, trackOrderId: orderId ?? undefined }),
    })
  const [repairOrderId, setRepairOrderId] = React.useState<string | null>(null)

  // Both panels follow the live row rather than a snapshot, so a stage recorded
  // inside the sheet is reflected without closing and reopening it.
  const trackedOrder = orders.find((order) => order.id === trackOrderId) ?? null
  const repairOrder = orders.find((order) => order.id === repairOrderId) ?? null

  // The material and stage filters offer exactly what is present in the
  // fetched orders.
  const columns = React.useMemo(() => {
    const materials = [...new Set(orders.map((o) => o.material))].sort()
    return getOrderColumns(
      materials.map((m) => ({ label: m, value: m })),
      stageFilterOptions(orders).map((s) => ({ label: s, value: s })),
      setSelectedOrder,
      (order) => setTrackedOrderId(order.id),
    )
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

      <ReceiveOrderDialog
        order={selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
      />

      <OrderTrackingSheet
        order={trackedOrder}
        onOpenChange={(open) => !open && setTrackedOrderId(null)}
        onLogRepair={(order) => setRepairOrderId(order.id)}
      />

      <LogRepairDialog
        order={repairOrder}
        onOpenChange={(open) => !open && setRepairOrderId(null)}
      />
    </div>
  )
}
