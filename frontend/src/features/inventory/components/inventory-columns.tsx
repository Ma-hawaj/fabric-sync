import { defineColumns } from '@/lib/define-columns'
import { EyeIcon, MinusIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import type { Location } from '@/features/locations/types/location'
import type { Material } from '../types/inventory'

function totalQuantity(material: Material) {
  return material.locations.reduce((sum, l) => sum + l.quantity, 0)
}

export const getInventoryColumns = (
  onViewStock: (material: Material) => void,
  locations: Location[],
  onRemoveStock: (material: Material) => void,
) =>
  defineColumns<Material>()([
    {
      accessorKey: 'name',
      size: 220,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Name" />
      ),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onViewStock(row.original)}
          className="font-medium text-info hover:underline"
        >
          {row.getValue('name')}
        </button>
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
      accessorKey: 'sku',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="SKU" />
      ),
      cell: ({ row }) => (
        <div className="font-mono text-muted-foreground">
          {row.getValue('sku') ?? '—'}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'SKU',
        placeholder: 'Filter SKU...',
        variant: 'text',
      },
    },
    {
      // Fabric family shared by a fabric's colour variants — filtering here
      // (e.g. "Zabrjad") clusters every colour of one fabric together.
      accessorKey: 'family',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Family" />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground">
          {row.getValue('family') ?? '—'}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Family',
        placeholder: 'Filter family...',
        variant: 'text',
      },
    },
    {
      id: 'locations',
      accessorFn: (material) => material.locations.map((l) => l.location),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Locations" />
      ),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.locations.map((l) => (
            <Badge key={l.locationId} variant="outline">
              {l.location}
            </Badge>
          ))}
        </div>
      ),
      enableSorting: false,
      enableColumnFilter: true,
      meta: {
        label: 'Locations',
        placeholder: 'Filter locations...',
        variant: 'multiSelect',
        // The filter matches against location names (see accessorFn above),
        // so option values are names rather than ids.
        options: locations.map((location) => ({
          label: location.name,
          value: location.name,
        })),
      },
    },
    {
      id: 'totalQuantity',
      accessorFn: totalQuantity,
      meta: { label: 'Total Quantity' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Total Quantity" />
      ),
      cell: ({ row }) => (
        <div>
          {row.getValue<number>('totalQuantity')} {row.original.unit}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: false,
    },
    {
      id: 'actions',
      size: 72,
      meta: { label: 'Actions' },
      header: 'Actions',
      enablePinning: true,
      cell: ({ row }) => (
        <RowActions
          items={[
            {
              label: 'View Stock',
              icon: EyeIcon,
              onClick: () => onViewStock(row.original),
            },
            {
              // Takes stock off without deleting the material. Disabled when
              // there is nothing to take — the backend would refuse every
              // entry.
              label: 'Remove Stock',
              icon: MinusIcon,
              disabled: totalQuantity(row.original) <= 0,
              onClick: () => onRemoveStock(row.original),
              separatorBefore: true,
            },
          ]}
        />
      ),
    },
  ])
