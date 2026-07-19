import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getInventoryColumns } from './components/inventory-columns'
import { InventoryDetailsSheet } from './components/inventory-details-sheet'
import { useInventory } from './hooks/use-inventory'
import { useLocations } from './hooks/use-locations'
import type { Material } from './types/inventory'

export function InventoryPage() {
  const { data: materials = [], isLoading } = useInventory()
  const { data: locations = [] } = useLocations()
  const [selectedMaterial, setSelectedMaterial] =
    React.useState<Material | null>(null)

  const columns = React.useMemo(
    () => getInventoryColumns(setSelectedMaterial, locations),
    [locations],
  )

  const { table } = useDataTable({
    data: materials,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Track materials and their stock across every location.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/inventory/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Stock
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading inventory...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <InventoryDetailsSheet
        material={selectedMaterial}
        onOpenChange={(open) => !open && setSelectedMaterial(null)}
      />
    </div>
  )
}
