import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTable } from '@/hooks/use-data-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getLocationColumns } from './components/location-columns'
import { useLocations } from './hooks/use-locations'
import { useUpdateLocation } from './hooks/use-update-location'
import type { Location } from './types/location'

export function LocationsPage() {
  const { data: locations = [], isLoading } = useLocations()
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

  const { table } = useDataTable({
    data: locations,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Locations</h1>
          <p className="text-muted-foreground">
            Branches customers collect orders from, stores that hold material
            stock, or both.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/locations/new" />}>
          <PlusIcon className="h-4 w-4" />
          Add Location
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading locations...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  )
}
