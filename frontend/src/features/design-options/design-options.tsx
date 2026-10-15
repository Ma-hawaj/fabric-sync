import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getDesignOptionColumns } from './components/design-option-columns'
import { useDesignOptions } from './hooks/use-design-options'
import { useUpdateDesignOption } from './hooks/use-update-design-option'
import type { DesignOption } from './types/design-option'

export function DesignOptionsPage() {
  const { data: options = [], isLoading } = useDesignOptions()
  const updateOption = useUpdateDesignOption()

  const toggleActive = React.useCallback(
    (option: DesignOption) => {
      const pending = updateOption.mutateAsync({
        id: option.id,
        isActive: !option.isActive,
      })
      toast.promise(pending, {
        loading: option.isActive
          ? `Retiring ${option.label}...`
          : `Restoring ${option.label}...`,
        success: (updated) =>
          updated.isActive
            ? `${updated.label} is back in its picker.`
            : `${updated.label} was retired and no longer appears in its picker.`,
        error: 'Could not update this option. Please try again.',
      })
    },
    [updateOption],
  )

  const columns = React.useMemo(
    () => getDesignOptionColumns(toggleActive, updateOption.isPending),
    [toggleActive, updateOption.isPending],
  )

  const { table } = useDataTable({
    data: options,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Design Options</h1>
          <p className="text-muted-foreground">
            The illustrated choices inside each order design slot. Retiring an
            option takes it out of its picker without erasing the orders that
            already used it.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/design-options/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Option
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading design options...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
