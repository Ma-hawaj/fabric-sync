import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { User } from '../types/user'

export const userColumns: ColumnDef<User, any>[] = [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="ID" />
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Name" />
    ),
    enableSorting: true,
    enableColumnFilter: true,
    meta: {
      label: 'Name',
      placeholder: 'Filter users...',
      variant: 'text',
    },
  },
]
