import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableAdvancedToolbar } from '@/components/data-table/data-table-advanced-toolbar'
import { getLocationColumns } from './components/location-columns'
import { useLocations } from './hooks/use-locations'
import { useUpdateLocation } from './hooks/use-update-location'
import type { Location } from './types/location'

export function LocationsPage() {
  const updateLocation = useUpdateLocation()

  const toggleActive = React.useCallback(
    (location: Location) => {
      const pending = updateLocation.mutateAsync({
        id: location.id,
        isActive: !location.isActive,
      })
      toast.promise(pending, {
        loading: location.isActive
          ? `Deactivating ${location.name}...`
          : `Activating ${location.name}...`,
        success: (updated) =>
          updated.isActive
            ? `${updated.name} is active again.`
            : `${updated.name} was deactivated and no longer appears in pickers.`,
        error: 'Could not update this location. Please try again.',
      })
    },
    [updateLocation],
  )

  const columns = React.useMemo(
    () => getLocationColumns(toggleActive, updateLocation.isPending),
    [toggleActive, updateLocation.isPending],
  )

  const { searchParams } = useListParams({ columns })
  const {
    data: locations,
    pageCount,
    total,
    isLoading,
  } = useLocations(searchParams)

  const { table } = useDataTable({
    data: locations,
    columns,
    pageCount,
    rowCount: total,
    enableAdvancedFilter: true,
  })

  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-3 [&>:first-child]:shrink-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Locations{' '}
            <span className="ms-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
              {isLoading ? '…' : total.toLocaleString()} records
            </span>
          </h1>
          <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            Branches, stock locations and capabilities.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/locations/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Location
        </Button>
      </div>

      <DataTable isLoading={isLoading} table={table}>
        <DataTableAdvancedToolbar table={table} />
      </DataTable>
    </div>
  )
}
