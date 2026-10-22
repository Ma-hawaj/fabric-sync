import * as React from 'react'
import { toast } from 'sonner'
import { useListParams } from '@/hooks/use-list-params'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getRepairColumns } from './components/repair-columns'
import { ReceiveRepairDialog } from './components/receive-repair-dialog'
import { useRepairs } from './hooks/use-repairs'
import { printRepairDocument } from './lib/print-repair'
import type { RepairListItem } from './types/orders'

export function RepairsPage() {
  const [receiveRepair, setReceiveRepair] =
    React.useState<RepairListItem | null>(null)

  const columns = React.useMemo(
    () =>
      getRepairColumns(
        (repair) => setReceiveRepair(repair),
        (repair) => {
          toast.promise(printRepairDocument(repair.orderId, repair.id), {
            loading: 'Preparing the repair receipt...',
            success: 'Receipt ready — choose "Save as PDF" to download it.',
            error: 'Could not prepare this receipt. Please try again.',
          })
        },
      ),
    [],
  )

  const { searchParams } = useListParams({ columns })
  const {
    data: repairs,
    pageCount,
    total,
    isLoading,
  } = useRepairs(searchParams)

  const { table } = useDataTable({
    data: repairs,
    columns,
    pageCount,
    rowCount: total,
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Repairs</h1>
        <p className="text-muted-foreground">
          Every garment brought back for rework — collect ready repairs, record
          measurement fixes, and print receipts.
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
    </div>
  )
}
