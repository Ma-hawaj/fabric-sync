import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Invoice } from '../types/invoices'

const MATERIALS = [
  'Bamboo Fiber',
  'Cashmere Blend',
  'Corduroy',
  'Cotton',
  'Cotton Blend',
  'Denim',
  'Hemp',
  'Jacquard',
  'Lace',
  'Linen',
  'Microfiber',
  'Organic Cotton',
  'Polyester',
  'Recycled Polyester',
  'Satin',
  'Silk',
  'Spandex Blend',
  'Tweed',
  'Velvet',
  'Wool',
]

const materialOptions = MATERIALS.map((m) => ({
  label: m,
  value: m,
}))

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export const invoiceColumns: ColumnDef<Invoice, any>[] = [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Invoice" />
    ),
    cell: ({ row }) => (
      <div className="font-mono font-medium">{row.getValue('id')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId)
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Invoice',
      placeholder: 'Filter invoice...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'customerName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Customer Name" />
    ),
    cell: ({ row }) => <div>{row.getValue('customerName')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId)
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Customer Name',
      placeholder: 'Filter customer...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'customerMobile',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Customer Mobile" />
    ),
    cell: ({ row }) => <div>{row.getValue('customerMobile')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<string>(columnId)
      return cellValue.toLowerCase().includes(String(filterValue).toLowerCase())
    },
    meta: {
      label: 'Customer Mobile',
      placeholder: 'Filter mobile...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'itemCount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Items" />
    ),
    cell: ({ row }) => <div>{row.getValue('itemCount')}</div>,
    enableSorting: true,
    enableColumnFilter: false,
    meta: {
      label: 'Items',
      variant: 'number',
    },
  },
  {
    accessorKey: 'materials',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Materials" />
    ),
    cell: ({ row }) => {
      const materials = row.getValue<string[]>('materials')
      return (
        <div className="flex flex-wrap gap-1">
          {materials.map((material) => (
            <Badge key={material} variant="secondary">
              {material}
            </Badge>
          ))}
        </div>
      )
    },
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
      label: 'Materials',
      placeholder: 'Filter materials...',
      variant: 'multiSelect',
      options: materialOptions,
    },
  },
  {
    accessorKey: 'totalPrice',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Total Price" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {currencyFormatter.format(row.getValue<number>('totalPrice'))}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<number>(columnId)

      if (!Array.isArray(filterValue)) return true

      const [minVal, maxVal] = filterValue
      const min =
        minVal !== undefined && minVal !== null ? Number(minVal) : undefined
      const max =
        maxVal !== undefined && maxVal !== null ? Number(maxVal) : undefined

      if (min !== undefined && !isNaN(min) && cellValue < min) return false
      if (max !== undefined && !isNaN(max) && cellValue > max) return false
      return true
    },
    meta: {
      label: 'Total Price',
      variant: 'range',
      range: [0, 2000],
      unit: '$',
    },
  },
]
