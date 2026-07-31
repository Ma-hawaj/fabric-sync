import { Link } from '@tanstack/react-router'
import { PencilIcon, PowerIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Location } from '@/features/locations/types/location'
import { CURRENCY } from '@/lib/currency'
import { productTotalStock } from '../types/product'
import type { Product } from '../types/product'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

// Both the "Locations" and "Status" columns filter an array-valued cell
// against the multiSelect toolbar filter, which hands over a string[].

export const getProductColumns = (
  onToggleActive: (product: Product) => void,
  isToggling: boolean,
  locations: Location[],
): ColumnDef<Product, any>[] => [
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
    accessorKey: 'unitPrice',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Price" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {currencyFormatter.format(row.getValue<number>('unitPrice'))}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    meta: {
      label: 'Price',
      variant: 'range',
      range: [0, 2000],
      unit: CURRENCY,
    },
  },
  {
    id: 'locations',
    accessorFn: (product) => product.locations.map((l) => l.location),
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
    accessorFn: productTotalStock,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="In Stock" />
    ),
    cell: ({ row }) => <div>{row.getValue<number>('totalQuantity')}</div>,
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'status',
    accessorFn: (product) => [product.isActive ? 'Active' : 'Inactive'],
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
              to="/products/$productId/edit"
              params={{ productId: row.original.id }}
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
