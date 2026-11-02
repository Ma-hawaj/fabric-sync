import { PermissionGuard } from '@/components/permission-guard'
import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getOrderStageColumns } from './components/order-stage-columns'
import { useOrderStages } from './hooks/use-order-stages'
import { useUpdateOrderStage } from './hooks/use-update-order-stage'
import type { OrderStage } from './types/order-stage'

export function OrderStagesPage() {
  const { data: stages = [], isLoading } = useOrderStages()
  const updateStage = useUpdateOrderStage()

  const toggleActive = React.useCallback(
    (stage: OrderStage) => {
      const pending = updateStage.mutateAsync({
        id: stage.id,
        isActive: !stage.isActive,
      })
      toast.promise(pending, {
        loading: stage.isActive
          ? `Retiring ${stage.name}...`
          : `Restoring ${stage.name}...`,
        success: (updated) =>
          updated.isActive
            ? `${updated.name} is back on the checklist.`
            : `${updated.name} was retired and no longer appears on new orders.`,
        error: 'Could not update this stage. Please try again.',
      })
    },
    [updateStage],
  )

  const columns = React.useMemo(
    () => getOrderStageColumns(toggleActive, updateStage.isPending),
    [toggleActive, updateStage.isPending],
  )

  const { table } = useDataTable({
    data: stages,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
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
            Order Stages
          </h1>
          <p className="mt-1.5 hidden text-sm leading-relaxed text-muted-foreground sm:block">
            Production checklist and delivery requirements.
          </p>
        </div>
        <PermissionGuard method="POST" path="/order-stages">
          <Button nativeButton={false} render={<Link to="/order-stages/new" />}>
            <PlusIcon className="h-4 w-4" />
            Add Stage
          </Button>
        </PermissionGuard>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableToolbar table={table} />
      </DataTable>
    </div>
  )
}
