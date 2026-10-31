import { PermissionGuard } from '@/components/permission-guard'
import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { getInventoryColumns } from './components/inventory-columns'
import { InventoryDetailsSheet } from './components/inventory-details-sheet'
import { AddStockDialog } from './components/add-stock-dialog'
import { EditMaterialDialog } from './components/edit-material-dialog'
import { TransferStockDialog } from './components/transfer-stock-dialog'
import { RemoveStockDialog } from './components/remove-stock-dialog'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import { useListParams } from '@/hooks/use-list-params'
import { useInventory } from './hooks/use-inventory'
import type { Material } from './types/inventory'

export function InventoryPage() {
  // Unfiltered on purpose: this facet lists where stock already sits, so a
  // since-deactivated location should stay selectable here.
  const { data: locations } = useAllLocations()
  const [addStockOpen, setAddStockOpen] = useState(false)
  const [addStockMaterial, setAddStockMaterial] = useState<Material | null>(
    null,
  )
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(
    null,
  )
  const [removeMaterial, setRemoveMaterial] = useState<Material | null>(null)

  const [editMaterial, setEditMaterial] = useState<Material | null>(null)
  const [transferMaterial, setTransferMaterial] = useState<Material | null>(
    null,
  )

  const columns = useMemo(
    () =>
      getInventoryColumns(
        setSelectedMaterial,
        locations,
        setRemoveMaterial,
        setEditMaterial,
        setTransferMaterial,
        (material) => {
          setAddStockMaterial(material)
          setAddStockOpen(true)
        },
      ),
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
      className="flex h-full min-h-0 min-w-0 flex-col gap-5 [&>:first-child]:shrink-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            Inventory{' '}
            <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
              {isLoading ? '…' : total.toLocaleString()} records
            </span>
          </h1>
          <p className="mt-1.5 hidden text-sm leading-relaxed text-muted-foreground sm:block">
            Material availability across all locations.
          </p>
        </div>
        <PermissionGuard method="POST" path="/materials">
          <Button
            onClick={() => {
              setAddStockMaterial(null)
              setAddStockOpen(true)
            }}
          >
            <PlusIcon className="h-4 w-4" />
            Add Stock
          </Button>
        </PermissionGuard>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar table={table} defaultSearchColumnId="name" />
      </DataTable>

      <AddStockDialog
        open={addStockOpen}
        onOpenChange={setAddStockOpen}
        material={addStockMaterial}
      />

      <InventoryDetailsSheet
        material={selectedMaterial}
        onOpenChange={(open) => !open && setSelectedMaterial(null)}
      />

      <EditMaterialDialog
        material={editMaterial}
        onOpenChange={(open) => !open && setEditMaterial(null)}
      />
      <TransferStockDialog
        material={transferMaterial}
        locations={locations}
        onOpenChange={(open) => !open && setTransferMaterial(null)}
      />
      <RemoveStockDialog
        material={removeMaterial}
        onOpenChange={(open) => !open && setRemoveMaterial(null)}
      />
    </div>
  )
}
