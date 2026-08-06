import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Customer } from '../types/customers'
import { BellIcon, BellOffIcon, EyeIcon } from 'lucide-react'

export const OPTED_IN_LABEL = 'Opted in'
export const OPTED_OUT_LABEL = 'Opted out'

// Shared with order-stage-columns.tsx's/location-columns.tsx's identical
// recipe: the multiSelect toolbar filter always hands back a string[].
function matchesAnySelected(cellValue: string[], filterValue: unknown) {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  return (filterValue as string[]).some((value) => cellValue.includes(value))
}

export const getCustomerColumns = (
  onViewDetails: (customer: Customer) => void,
  onToggleOptIn: (customer: Customer) => void,
  isTogglingOptIn: boolean,
): ColumnDef<Customer, any>[] => [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="ID" />
    ),
    cell: ({ row }) => (
      <div className="font-mono text-muted-foreground">
        {row.getValue('id')}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'ID',
      placeholder: 'Filter ID...',
      variant: 'text',
    },
  },
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
    accessorKey: 'mobileNo',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Phone Number" />
    ),
    cell: ({ row }) => <div>{row.getValue('mobileNo')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId)
      return val.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Phone Number',
      placeholder: 'Filter phone...',
      variant: 'text',
    },
  },
  {
    id: 'marketingOptIn',
    accessorFn: (customer) => [
      customer.marketingOptIn ? OPTED_IN_LABEL : OPTED_OUT_LABEL,
    ],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Marketing" />
    ),
    cell: ({ row }) =>
      row.original.marketingOptIn ? (
        <Badge variant="secondary">{OPTED_IN_LABEL}</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          {OPTED_OUT_LABEL}
        </Badge>
      ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
    meta: {
      label: 'Marketing',
      placeholder: 'Filter...',
      variant: 'multiSelect',
      options: [
        { label: OPTED_IN_LABEL, value: OPTED_IN_LABEL },
        { label: OPTED_OUT_LABEL, value: OPTED_OUT_LABEL },
      ],
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewDetails(row.original)}
          className="h-8 w-auto px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
        >
          <EyeIcon className="mr-1.5 h-4 w-4" />
          View Details
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isTogglingOptIn}
          onClick={() => onToggleOptIn(row.original)}
          className="h-8 w-auto px-2"
        >
          {row.original.marketingOptIn ? (
            <>
              <BellOffIcon className="mr-1.5 h-4 w-4" />
              Opt out
            </>
          ) : (
            <>
              <BellIcon className="mr-1.5 h-4 w-4" />
              Opt in
            </>
          )}
        </Button>
      </div>
    ),
  },
]
