import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Order } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'SAR',
})

// Invoice ids are uuidv7 — time-ordered, so the short prefix still sorts by
// creation and is unique enough to identify an invoice at a glance.
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase()
}

export const getOrderColumns = (
  materialOptions: { label: string; value: string }[],
): ColumnDef<Order, any>[] => [
  {
    accessorKey: 'invoiceId',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Invoice" />
    ),
    cell: ({ row }) => (
      <div className="font-mono font-medium">
        {shortId(row.getValue('invoiceId'))}
      </div>
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
    accessorKey: 'invoiceDate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Invoice Date" />
    ),
    cell: ({ row }) => {
      const date = row.getValue<Date>('invoiceDate')
      return <div>{date.toLocaleDateString()}</div>
    },
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      const cellValue = row.getValue<Date>(columnId)
      const time = cellValue.getTime()

      if (!Array.isArray(filterValue)) {
        if (typeof filterValue === 'number') {
          return (
            cellValue.toDateString() === new Date(filterValue).toDateString()
          )
        }
        return true
      }

      const [startVal, endVal] = filterValue
      const start =
        startVal !== undefined && startVal !== null
          ? Number(startVal)
          : undefined
      const end =
        endVal !== undefined && endVal !== null ? Number(endVal) : undefined

      if (start !== undefined && !isNaN(start)) {
        const startDate = new Date(start)
        startDate.setHours(0, 0, 0, 0)
        if (time < startDate.getTime()) return false
      }
      if (end !== undefined && !isNaN(end)) {
        const endDate = new Date(end)
        endDate.setHours(23, 59, 59, 999)
        if (time > endDate.getTime()) return false
      }
      return true
    },
    meta: {
      label: 'Invoice Date',
      variant: 'dateRange',
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
    accessorKey: 'material',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Material" />
    ),
    cell: ({ row }) => <div>{row.getValue('material')}</div>,
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) => {
      if (
        !filterValue ||
        (Array.isArray(filterValue) && filterValue.length === 0)
      )
        return true
      const cellValue = row.getValue<string>(columnId)
      return (filterValue as string[]).includes(cellValue)
    },
    meta: {
      label: 'Material',
      placeholder: 'Filter materials...',
      variant: 'multiSelect',
      options: materialOptions,
    },
  },
  {
    accessorKey: 'materialAmount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Quantity" />
    ),
    cell: ({ row }) => <div>{row.getValue<number>('materialAmount')} m</div>,
    enableSorting: true,
    enableColumnFilter: false,
    meta: {
      label: 'Quantity',
      variant: 'number',
    },
  },
  {
    accessorKey: 'price',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Price" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {currencyFormatter.format(row.getValue<number>('price'))}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
    meta: {
      label: 'Price',
      variant: 'number',
    },
  },
]
