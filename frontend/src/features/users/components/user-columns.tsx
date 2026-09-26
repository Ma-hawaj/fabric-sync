import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { User } from '../types/user'
import { UserAvatar } from './user-avatar'

function joinedOrDash(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—'
}

export const userColumns: ColumnDef<User, any>[] = [
  {
    id: 'avatar',
    header: 'Avatar',
    cell: ({ row }) => <UserAvatar user={row.original} />,
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
  {
    accessorKey: 'email',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Email" />
    ),
    cell: ({ row }) => row.original.email ?? '—',
  },
  {
    accessorKey: 'roles',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Roles" />
    ),
    cell: ({ row }) => joinedOrDash(row.original.roles),
  },
  {
    accessorKey: 'groups',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Groups" />
    ),
    cell: ({ row }) => joinedOrDash(row.original.groups),
  },
]
