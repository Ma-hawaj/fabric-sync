import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Customer } from '../types/customers'
import { EyeIcon } from 'lucide-react'

export const getCustomerColumns = (
  onViewDetails: (customer: Customer) => void
): ColumnDef<Customer, any>[] => [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="ID" />
    ),
    cell: ({ row }) => <div className="font-mono text-muted-foreground">{row.getValue('id')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId);
      return val.toLowerCase().includes(String(filterValue).toLowerCase());
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
    cell: ({ row }) => <div className="font-medium">{row.getValue('name')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const val = row.getValue<string>(columnId);
      return val.toLowerCase().includes(String(filterValue).toLowerCase());
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
      const val = row.getValue<string>(columnId);
      return val.toLowerCase().includes(String(filterValue).toLowerCase());
    },
    meta: {
      label: 'Phone Number',
      placeholder: 'Filter phone...',
      variant: 'text',
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onViewDetails(row.original)}
        className="h-8 w-auto px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
      >
        <EyeIcon className="mr-1.5 h-4 w-4" />
        View Details
      </Button>
    ),
  },
]
