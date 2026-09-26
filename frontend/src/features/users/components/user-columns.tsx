import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import type { User } from '../types/user'
import { UserAvatar } from './user-avatar'

function NameBadges({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="secondary">
          {value}
        </Badge>
      ))}
    </span>
  )
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
    cell: ({ row }) => <NameBadges values={row.original.roles} />,
  },
  {
    accessorKey: 'groups',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Groups" />
    ),
    cell: ({ row }) => <NameBadges values={row.original.groups} />,
  },
]
