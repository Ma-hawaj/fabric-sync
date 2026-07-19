import type { ColumnDef } from '@tanstack/react-table'
import { EyeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Material } from '../types/inventory'

function totalQuantity(material: Material) {
  return material.locations.reduce((sum, l) => sum + l.quantity, 0)
}

export const getInventoryColumns = (
  onViewStock: (material: Material) => void,
  locations: string[],
): ColumnDef<Material, any>[] => [
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
      const cellValue = row.getValue<string>(columnId)
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase())
    },
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
        {row.getValue('sku')}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId)
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'SKU',
      placeholder: 'Filter SKU...',
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
          <Badge key={l.location} variant="outline">
            {l.location}
          </Badge>
        ))}
      </div>
    ),
    enableSorting: false,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      if (
        !filterValue ||
        (Array.isArray(filterValue) && filterValue.length === 0)
      )
        return true
      const cellValue = row.getValue<string[]>(columnId)
      return (filterValue as string[]).some((value) =>
        cellValue.includes(value),
      )
    },
    meta: {
      label: 'Locations',
      placeholder: 'Filter locations...',
      variant: 'multiSelect',
      options: locations.map((location) => ({
        label: location,
        value: location,
      })),
    },
  },
  {
    id: 'totalQuantity',
    accessorFn: totalQuantity,
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
    header: 'Actions',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onViewStock(row.original)}
        className="h-8 w-auto px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
      >
        <EyeIcon className="mr-1.5 h-4 w-4" />
        View Stock
      </Button>
    ),
  },
]
