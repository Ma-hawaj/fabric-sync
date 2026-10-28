import { PermissionGuard } from '@/components/permission-guard'
import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import { defineColumns } from '@/lib/define-columns'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import type { Location } from '../types/location'

export const RECEIVES_ORDERS_LABEL = 'Receives orders'
export const HOLDS_STOCK_LABEL = 'Holds stock'

export function locationUses(location: Location): string[] {
  const uses: string[] = []
  if (location.receivesOrders) uses.push(RECEIVES_ORDERS_LABEL)
  if (location.holdsStock) uses.push(HOLDS_STOCK_LABEL)
  return uses
}

export const getLocationColumns = (
  onToggleActive: (location: Location) => void,
  isToggling: boolean,
) =>
  defineColumns<Location>()([
    {
      accessorKey: 'name',
      size: 220,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Name" />
      ),
      cell: ({ row }) => (
        <PermissionGuard
          method="PATCH"
          path="/locations/:id"
          fallback={<span>{row.getValue('name')}</span>}
        >
          <Link
            to="/locations/$locationId/edit"
            params={{ locationId: row.original.id }}
            className="font-medium text-info hover:underline"
          >
            {row.getValue('name')}
          </Link>
        </PermissionGuard>
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
          { label: RECEIVES_ORDERS_LABEL, value: 'receivesOrders' },
          { label: HOLDS_STOCK_LABEL, value: 'holdsStock' },
        ],
      },
    },
    {
      id: 'status',
      accessorFn: (location) => [location.isActive ? 'Active' : 'Inactive'],
      size: 96,
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
      size: 72,
      meta: { label: 'Actions' },
      header: 'Actions',
      enablePinning: true,
      cell: ({ row }) => {
        const location = row.original
        return (
          <PermissionGuard method="PATCH" path="/locations/:id">
            <RowActions
              items={[
                {
                  label: 'Edit',
                  icon: PencilIcon,
                  render: (
                    <Link
                      to="/locations/$locationId/edit"
                      params={{ locationId: location.id }}
                    />
                  ),
                },
                {
                  label: location.isActive ? 'Deactivate' : 'Activate',
                  icon: PowerIcon,
                  disabled: isToggling,
                  onClick: () => onToggleActive(location),
                },
              ]}
            />
          </PermissionGuard>
        )
      },
    },
  ])
