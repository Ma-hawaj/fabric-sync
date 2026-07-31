import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Location } from '../types/location'

export const RECEIVES_ORDERS_LABEL = 'Receives orders'
export const HOLDS_STOCK_LABEL = 'Holds stock'

// Filtering happens in the database now, so an option's `value` is the token
// the API matches on while its `label` stays the words staff read. The cell
// still renders the labels via `locationUses`.
export const RECEIVES_ORDERS_VALUE = 'receivesOrders'
export const HOLDS_STOCK_VALUE = 'holdsStock'

export function locationUses(location: Location): string[] {
  const uses: string[] = []
  if (location.receivesOrders) uses.push(RECEIVES_ORDERS_LABEL)
  if (location.holdsStock) uses.push(HOLDS_STOCK_LABEL)
  return uses
}

// Shared by the "Used for" and "Status" columns: both filter an array-valued
// cell against the multiSelect toolbar filter, which hands over a string[].

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
    meta: {
      label: 'Used For',
      placeholder: 'Filter use...',
      variant: 'multiSelect',
      options: [
        { label: RECEIVES_ORDERS_LABEL, value: RECEIVES_ORDERS_VALUE },
        { label: HOLDS_STOCK_LABEL, value: HOLDS_STOCK_VALUE },
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
    meta: {
      label: 'Status',
      placeholder: 'Filter status...',
      variant: 'multiSelect',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
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
