import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Location } from '../types/location'

export const RECEIVES_ORDERS_LABEL = 'Receives orders'
export const HOLDS_STOCK_LABEL = 'Holds stock'

export function locationUses(location: Location): string[] {
  const uses: string[] = []
  if (location.receivesOrders) uses.push(RECEIVES_ORDERS_LABEL)
  if (location.holdsStock) uses.push(HOLDS_STOCK_LABEL)
  return uses
}

// Shared by the "Used for" and "Status" columns: both filter an array-valued
// cell against the multiSelect toolbar filter, which hands over a string[].
function matchesAnySelected(cellValue: string[], filterValue: unknown) {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  return (filterValue as string[]).some((value) => cellValue.includes(value))
}

export const getLocationColumns = (
  onToggleActive: (location: Location) => void,
  isToggling: boolean,
): ColumnDef<Location, any>[] => [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Name" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue('name')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Name',
      placeholder: 'Filter name...',
      variant: 'text',
    },
  },
  {
    id: 'uses',
    accessorFn: locationUses,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Used For" />
    ),
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {locationUses(row.original).map((use) => (
          <Badge key={use} variant="outline">
            {use}
          </Badge>
        ))}
      </div>
    ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Used For',
      placeholder: 'Filter use...',
      variant: 'multiSelect',
      options: [
        { label: RECEIVES_ORDERS_LABEL, value: RECEIVES_ORDERS_LABEL },
        { label: HOLDS_STOCK_LABEL, value: HOLDS_STOCK_LABEL },
      ],
    },
  },
  {
    id: 'status',
    accessorFn: (location) => [location.isActive ? 'Active' : 'Inactive'],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Status" />
    ),
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="secondary">Active</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Inactive
        </Badge>
      ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Status',
      placeholder: 'Filter status...',
      variant: 'multiSelect',
      options: [
        { label: 'Active', value: 'Active' },
        { label: 'Inactive', value: 'Inactive' },
      ],
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="h-8 w-auto px-2"
          render={
            <Link
              to="/locations/$locationId/edit"
              params={{ locationId: row.original.id }}
            />
          }
        >
          <PencilIcon className="mr-1.5 h-4 w-4" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isToggling}
          onClick={() => onToggleActive(row.original)}
          className="h-8 w-auto px-2"
        >
          <PowerIcon className="mr-1.5 h-4 w-4" />
          {row.original.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </div>
    ),
  },
]
