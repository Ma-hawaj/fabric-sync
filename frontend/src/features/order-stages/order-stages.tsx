import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
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
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Order Stages</h1>
          <p className="text-muted-foreground">
            The steps every order walks through in production. Retiring a stage
            takes it off the checklist without erasing the orders that already
            passed through it.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/order-stages/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Stage
        </Button>
      </div>

      {isLoading ? (
        <LoadingIndicator label="Loading order stages..." />
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
