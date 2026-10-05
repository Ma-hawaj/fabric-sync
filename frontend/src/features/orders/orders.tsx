import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getOrderColumns } from './components/order-columns'
import { ReceiveOrderDialog } from './components/receive-order-dialog'
import { useAllInventory } from '@/features/inventory/hooks/use-inventory'
import { useOrderStages } from '@/features/order-stages/hooks/use-order-stages'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import {
  orderReceivingLocations,
  productionLocations as productionLocationOptions,
} from '@/features/locations/lib/location-filters'
import { useListParams } from '@/hooks/use-list-params'
import { useOrders } from './hooks/use-orders'
import type { Order } from './types/orders'

export function OrdersPage() {
  const [selectedOrder, setSelectedOrder] = React.useState<Order | null>(null)
  const navigate = useNavigate()

  // The material and stage filters come from their own whole-list queries.
  // Deriving the options from the orders on screen would, under server-side
  // paging, offer only the ones the current page happens to mention. Location
  // filters work the same way: receiving branches and production (material
  // stock) locations come from the whole locations list, narrowed by
  // capability.
  const { data: materials } = useAllInventory()
  const { data: stages = [] } = useOrderStages()
  const { data: locations = [] } = useAllLocations()
  const columns = React.useMemo(() => {
    const names = [
      ...new Set(materials.map((material) => material.name)),
    ].sort()
    const receiving = orderReceivingLocations(locations).map((location) => ({
      label: location.name,
      value: location.name,
    }))
    const production = productionLocationOptions(locations).map((location) => ({
      label: location.name,
      value: location.name,
    }))
    return getOrderColumns(
      names.map((name) => ({ label: name, value: name })),
      stages.map((stage) => ({ label: stage.name, value: stage.name })),
      receiving,
      production,
      setSelectedOrder,
      (order) =>
        void navigate({
          to: '/orders/$orderId',
          params: { orderId: order.id },
        }),
    )
  }, [materials, stages, locations, navigate])

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
