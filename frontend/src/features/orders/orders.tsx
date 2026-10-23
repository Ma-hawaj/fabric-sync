import * as React from 'react'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { getOrderColumns } from './components/order-columns'
import { CollectOrderDialog } from './components/collect-order-dialog'
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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
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
      ...new Set([
        'Customer-provided material',
        ...materials.map((material) => material.name),
      ]),
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
    enableAdvancedFilter: true,
    initialState: {
      columnVisibility: {
        customerMobile: false,
        invoiceDate: false,
        collectedAt: false,
        invoicePaymentStatus: false,
        paymentMethod: false,
        price: false,
      },
      columnPinning: { left: ['orderNumber'], right: ['actions'] },
    },
  })

  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-3 [&>:first-child]:shrink-0"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Orders{' '}
          <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
            {isLoading ? '…' : total.toLocaleString()} records
          </span>
        </h1>
        <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
          Production, collection and payment status at a glance.
        </p>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar
          table={table}
          defaultSearchColumnId="customerMobile"
          quickFilter={{ columnId: 'status', allLabel: 'All statuses' }}
        />
      </DataTable>

      <CollectOrderDialog
        order={selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
      />
    </div>
  )
}
