import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { getInventoryColumns } from './components/inventory-columns'
import { InventoryDetailsSheet } from './components/inventory-details-sheet'
import { RemoveStockDialog } from './components/remove-stock-dialog'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import { useListParams } from '@/hooks/use-list-params'
import { useInventory } from './hooks/use-inventory'
import type { Material } from './types/inventory'

export function InventoryPage() {
  // Unfiltered on purpose: this facet lists where stock already sits, so a
  // since-deactivated location should stay selectable here.
  const { data: locations } = useAllLocations()
  const [selectedMaterial, setSelectedMaterial] =
    React.useState<Material | null>(null)
  const [removeMaterial, setRemoveMaterial] = React.useState<Material | null>(
    null,
  )

  const columns = React.useMemo(
    () =>
      getInventoryColumns(setSelectedMaterial, locations, setRemoveMaterial),
    [locations],
  )

  const { searchParams } = useListParams({ columns })
  const {
    data: materials,
    pageCount,
    total,
    isLoading,
  } = useInventory(searchParams)

  const { table } = useDataTable({
    data: materials,
    columns,
    pageCount,
    rowCount: total,
    enableAdvancedFilter: true,
    initialState: { columnPinning: { right: ['actions'] } },
  })

  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-3 [&>:first-child]:shrink-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Inventory{' '}
            <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
              {isLoading ? '…' : total.toLocaleString()} records
            </span>
          </h1>
          <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            Material availability across all locations.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/inventory/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Stock
        </Button>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar table={table} defaultSearchColumnId="name" />
      </DataTable>

      <InventoryDetailsSheet
        material={selectedMaterial}
        onOpenChange={(open) => !open && setSelectedMaterial(null)}
      />

      <RemoveStockDialog
        material={removeMaterial}
        onOpenChange={(open) => !open && setRemoveMaterial(null)}
      />
    </div>
  )
}
