import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { CURRENCY } from '@/lib/currency'
import type { Invoice, PaymentStatus } from '../types/invoices'

const paymentTypeLabels: Record<
  NonNullable<Invoice['finalPaymentType']>,
  string
> = {
  benefit: 'Benefit',
  cash: 'Cash',
  card: 'Card',
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

// Invoice ids are uuidv7 — time-ordered, so the short prefix still sorts by
// creation and is unique enough to identify an invoice at a glance.
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase()
}

const PAYMENT_STATUS_VARIANT: Record<
  PaymentStatus,
  'destructive' | 'secondary' | 'default'
> = {
  unpaid: 'destructive',
  partial: 'secondary',
  paid: 'default',
}

export const getInvoiceColumns = (
  materialOptions: { label: string; value: string }[],
  onReceive: (invoice: Invoice) => void,
): ColumnDef<Invoice, any>[] => [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Invoice" />
    ),
    cell: ({ row }) => (
      <div className="font-mono font-medium">{shortId(row.getValue('id'))}</div>
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
    id: 'date',
    accessorFn: (invoice) => new Date(invoice.date),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Date" />
    ),
    cell: ({ row }) => (
      <div>{row.getValue<Date>('date').toLocaleDateString()}</div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'customerName',
    accessorFn: (invoice) => invoice.customers.map((c) => c.name).join(', '),
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
    id: 'customerMobile',
    accessorFn: (invoice) =>
      invoice.customers.map((c) => c.mobileNo).join(', '),
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
    accessorKey: 'paymentStatus',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Payment" />
    ),
    cell: ({ row }) => {
      const status = row.getValue<PaymentStatus>('paymentStatus')
      return (
        <Badge variant={PAYMENT_STATUS_VARIANT[status]} className="capitalize">
          {status}
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
      return (filterValue as string[]).includes(row.getValue(columnId))
    },
    meta: {
      label: 'Payment',
      placeholder: 'Filter payment...',
      variant: 'multiSelect',
      options: [
        { label: 'Unpaid', value: 'unpaid' },
        { label: 'Partial', value: 'partial' },
        { label: 'Paid', value: 'paid' },
      ],
    },
  },
  {
    id: 'paymentMethod',
    accessorFn: (invoice) =>
      invoice.finalPaymentType ?? invoice.advancePaymentType,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Payment Method" />
    ),
    cell: ({ row }) => {
      const type = row.getValue<Invoice['finalPaymentType']>('paymentMethod')
      return <div>{type ? paymentTypeLabels[type] : '—'}</div>
    },
    enableSorting: true,
    enableColumnFilter: false,
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
      unit: CURRENCY,
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => {
      const invoice = row.original
      const isPaid = invoice.paymentStatus === 'paid'
      return (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPaid}
          onClick={() => onReceive(invoice)}
          className="h-8 w-auto px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
        >
          {isPaid ? 'Received' : 'Mark Received'}
        </Button>
      )
    },
  },
]
