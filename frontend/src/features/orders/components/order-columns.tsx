import type { ColumnDef } from '@tanstack/react-table'
import { ListChecksIcon, CheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import { CURRENCY } from '@/lib/currency'
import {
  COMPLETED,
  currentStageLabel,
  openRepairCount,
} from '../lib/order-tracking'
import type { Order } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
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

const paymentTypeLabels: Record<
  NonNullable<Order['invoicePaymentMethod']>,
  string
> = {
  benefit: 'Benefit',
  cash: 'Cash',
  card: 'Card',
}

export function getOrderColumns(
  materialOptions: { label: string; value: string }[],
  stageOptions: { label: string; value: string }[],
  onReceive: (order: Order) => void,
  onOpen: (order: Order) => void,
): ColumnDef<Order, any>[] {
  return [
    {
      accessorKey: 'orderNumber',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Order" />
      ),
      cell: ({ row }) => (
        <div className="font-mono font-medium">
          ORD-{row.getValue<number>('orderNumber')}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Order',
        placeholder: 'Filter order...',
        variant: 'number',
      },
    },
    {
      accessorKey: 'invoiceNumber',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Invoice" />
      ),
      cell: ({ row }) => (
        <div className="font-mono font-medium">
          INV-{row.getValue<number>('invoiceNumber')}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Invoice',
        placeholder: 'Filter invoice...',
        variant: 'number',
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
      meta: {
        label: 'Status',
        variant: 'multiSelect',
        options: statusOptions,
      },
    },
    {
      id: 'stage',
      accessorFn: currentStageLabel,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Stage" />
      ),
      cell: ({ row }) => {
        const label = row.getValue<string>('stage')
        return (
          <Badge variant={label === COMPLETED ? 'default' : 'secondary'}>
            {label}
          </Badge>
        )
      },
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Stage',
        placeholder: 'Filter stage...',
        variant: 'multiSelect',
        options: stageOptions,
      },
    },
    {
      id: 'repairs',
      accessorFn: openRepairCount,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Repairs" />
      ),
      cell: ({ row }) => {
        const open = row.getValue<number>('repairs')
        const total = row.original.repairs.length
        if (total === 0) return <div className="text-muted-foreground">—</div>
        return (
          <Badge variant={open > 0 ? 'secondary' : 'outline'}>
            {open > 0 ? `${open} open` : `${total} closed`}
          </Badge>
        )
      },
      enableSorting: true,
      enableColumnFilter: false,
    },
    {
      id: 'balanceDue',
      // Server-computed: the total less gift card tender and every payment.
      accessorFn: (order) => order.invoiceBalanceDue,
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
      meta: {
        label: 'Payment Status',
        variant: 'multiSelect',
        options: paymentStatusOptions,
      },
    },
    {
      id: 'paymentMethod',
      accessorFn: (order) => order.invoicePaymentMethod,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Payment Method" />
      ),
      cell: ({ row }) => {
        const type =
          row.getValue<Order['invoicePaymentMethod']>('paymentMethod')
        return <div>{type ? paymentTypeLabels[type] : '—'}</div>
      },
      enableSorting: true,
      enableColumnFilter: false,
    },
    {
      id: 'actions',
      header: 'Actions',
      enablePinning: true,
      cell: ({ row }) => {
        const order = row.original
        return (
          <RowActions
            items={[
              {
                label: 'Details',
                icon: ListChecksIcon,
                onClick: () => onOpen(order),
              },
              {
                label:
                  order.status === 'received' ? 'Received' : 'Mark Received',
                icon: CheckIcon,
                disabled: order.status === 'received',
                onClick: () => onReceive(order),
                separatorBefore: true,
              },
            ]}
          />
        )
      },
    },
  ]
}
