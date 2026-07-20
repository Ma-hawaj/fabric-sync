import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import type { Order } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Received', value: 'received' },
]

const paymentStatusOptions = [
  { label: 'Unpaid', value: 'unpaid' },
  { label: 'Partial', value: 'partial' },
  { label: 'Paid', value: 'paid' },
]

export function getOrderColumns(
  onReceive: (order: Order) => void,
): ColumnDef<Order, any>[] {
  return [
    {
      accessorKey: 'invoiceId',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Invoice" />
      ),
      cell: ({ row }) => (
        <div className="font-mono font-medium">{row.getValue('invoiceId')}</div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: (row, columnId, filterValue) => {
        const cellValue = row.getValue<string>(columnId)
        return cellValue
          .toLowerCase()
          .includes(String(filterValue).toLowerCase())
      },
      meta: {
        label: 'Invoice',
        placeholder: 'Filter invoice...',
        variant: 'text',
      },
    },
    {
      id: 'invoiceDate',
      accessorFn: (order) => new Date(order.invoiceDate),
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
        return cellValue
          .toLowerCase()
          .includes(String(filterValue).toLowerCase())
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
        return cellValue
          .toLowerCase()
          .includes(String(filterValue).toLowerCase())
      },
      meta: {
        label: 'Customer Mobile',
        placeholder: 'Filter mobile...',
        variant: 'text',
      },
    },
    {
      accessorKey: 'materialName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Material" />
      ),
      cell: ({ row }) => <div>{row.getValue('materialName')}</div>,
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: (row, columnId, filterValue) => {
        const cellValue = row.getValue<string>(columnId)
        return cellValue
          .toLowerCase()
          .includes(String(filterValue).toLowerCase())
      },
      meta: {
        label: 'Material',
        placeholder: 'Filter material...',
        variant: 'text',
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Status" />
      ),
      cell: ({ row }) => {
        const status = row.getValue<Order['status']>('status')
        return (
          <Badge variant={status === 'received' ? 'default' : 'secondary'}>
            {status === 'received' ? 'Received' : 'Pending'}
          </Badge>
        )
      },
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
        label: 'Status',
        variant: 'multiSelect',
        options: statusOptions,
      },
    },
    {
      id: 'balanceDue',
      accessorFn: (order) =>
        Math.max(order.invoiceTotalPrice - order.invoiceAmountPaid, 0),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Balance Due" />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {currencyFormatter.format(row.getValue<number>('balanceDue'))}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: false,
    },
    {
      accessorKey: 'invoicePaymentStatus',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Payment Status" />
      ),
      cell: ({ row }) => {
        const status = row.getValue<Order['invoicePaymentStatus']>(
          'invoicePaymentStatus',
        )
        const label =
          status === 'paid'
            ? 'Paid'
            : status === 'partial'
              ? 'Partial'
              : 'Unpaid'
        return (
          <Badge variant={status === 'paid' ? 'default' : 'outline'}>
            {label}
          </Badge>
        )
      },
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
        label: 'Payment Status',
        variant: 'multiSelect',
        options: paymentStatusOptions,
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const order = row.original
        return (
          <Button
            variant="ghost"
            size="sm"
            disabled={order.status === 'received'}
            onClick={() => onReceive(order)}
            className="h-8 w-auto px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
          >
            {order.status === 'received' ? 'Received' : 'Mark Received'}
          </Button>
        )
      },
    },
  ]
}
