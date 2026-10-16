import * as React from 'react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getRepairColumns } from './components/repair-columns'
import { ReceiveRepairDialog } from './components/receive-repair-dialog'
import { FixRepairMeasurementDialog } from './components/fix-repair-measurement-dialog'
import { useRepairs } from './hooks/use-repairs'
import { printRepairDocument } from './lib/print-repair'
import type { RepairListItem } from './types/orders'

export function RepairsPage() {
  const { data: repairs = [], isLoading } = useRepairs()
  const [receiveRepair, setReceiveRepair] =
    React.useState<RepairListItem | null>(null)
  const [fixRepair, setFixRepair] = React.useState<RepairListItem | null>(null)

  const columns = React.useMemo(
    () =>
      getRepairColumns(
        (repair) => setReceiveRepair(repair),
        (repair) => setFixRepair(repair),
        (repair) => {
          const pending = printRepairDocument(repair.orderId, repair.id).catch(
            () => {
              // toast.promise below reports the failure; this just avoids an
              // unhandled rejection.
            },
          )
          toast.promise(pending, {
            loading: 'Preparing the repair receipt...',
            success: 'Receipt ready — choose "Save as PDF" to download it.',
            error: 'Could not prepare this receipt. Please try again.',
          })
        },
      ),
    [],
  )

  const { table } = useDataTable({
    data: repairs,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Repairs</h1>
        <p className="text-muted-foreground">
          Every garment brought back for rework — receive finished repairs,
          record measurement fixes, and print receipts.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground">
          Loading repairs...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <ReceiveRepairDialog
        repair={receiveRepair}
        onOpenChange={(open) => !open && setReceiveRepair(null)}
      />
      <FixRepairMeasurementDialog
        repair={fixRepair}
        onOpenChange={(open) => !open && setFixRepair(null)}
      />
    </div>
  )
}
