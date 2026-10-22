import { defineColumns } from '@/lib/define-columns'
import { Link } from '@tanstack/react-router'
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
  { label: 'Ready for pickup', value: 'ready' },
  { label: 'Collected', value: 'collected' },
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
  receivingOptions: { label: string; value: string }[],
  productionOptions: { label: string; value: string }[],
  onCollect: (order: Order) => void,
  onOpen: (order: Order) => void,
) {
  return defineColumns<Order>()([
    {
      accessorKey: 'orderNumber',
      size: 88,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Order" />
      ),
      cell: ({ row }) => (
        <Link
          to="/orders/$orderId"
          params={{ orderId: row.original.id }}
          className="font-mono font-medium text-info hover:underline"
        >
          ORD-{row.getValue<number>('orderNumber')}
        </Link>
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
      size: 88,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Invoice" />
      ),
      cell: ({ row }) => (
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId: row.original.invoiceId }}
          className="font-mono font-medium text-info hover:underline"
        >
          INV-{row.getValue<number>('invoiceNumber')}
        </Link>
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
      cell: ({ row }) => (
        <div
          className="truncate leading-tight"
          title={`${row.original.customerName} · ${row.original.customerMobile}`}
        >
          <div className="truncate font-medium">
            {row.original.customerName}
          </div>
          <span className="text-xs text-muted-foreground">
            {row.original.customerMobile}
          </span>
        </div>
      ),
      size: 190,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Customer Name" />
      ),
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
      size: 150,
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
      size: 138,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Material" />
      ),
      cell: ({ row }) => (
        <div>
          {row.getValue('material')}
          {row.original.materialSource === 'customer' && (
            <div className="text-xs text-muted-foreground">
              Customer-provided material
            </div>
          )}
        </div>
      ),
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
      size: 90,
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
      accessorKey: 'receivingLocation',
      size: 114,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Receiving" />
      ),
      cell: ({ row }) => (
        <div>{row.getValue<string | null>('receivingLocation') ?? '—'}</div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Receiving',
        placeholder: 'Filter receiving...',
        variant: 'multiSelect',
        options: receivingOptions,
      },
    },
    {
      accessorKey: 'productionLocation',
      size: 114,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Production" />
      ),
      cell: ({ row }) => {
        const location = row.getValue<string | null>('productionLocation')
        if (!location) return <div className="text-muted-foreground">—</div>
        return (
          <div>
            {location}
            {row.original.productionLocationInferred && (
              <span className="text-muted-foreground"> • inferred</span>
            )}
          </div>
        )
      },
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Production',
        placeholder: 'Filter production...',
        variant: 'multiSelect',
        options: productionOptions,
      },
    },
    {
      accessorKey: 'price',
      size: 110,
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
      size: 96,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Collection" />
      ),
      cell: ({ row }) => {
        const status = row.getValue<Order['status']>('status')
        return (
          <Badge variant={status === 'collected' ? 'default' : 'secondary'}>
            {status === 'collected'
              ? 'Collected'
              : status === 'ready'
                ? 'Ready for pickup'
                : 'Pending'}
          </Badge>
        )
      },
      enableSorting: true,
      enableColumnFilter: true,
      meta: {
        label: 'Collection',
        variant: 'multiSelect',
        options: statusOptions,
      },
    },
    {
      accessorKey: 'collectedAt',
      meta: { label: 'Collected At', variant: 'dateRange' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Collected At" />
      ),
      cell: ({ row }) => {
        const collectedAt = row.getValue<Date | null>('collectedAt')
        if (!collectedAt) return <div className="text-muted-foreground">—</div>
        return <div>{collectedAt.toLocaleString()}</div>
      },
      enableSorting: true,
      enableColumnFilter: true,
    },
    {
      id: 'stage',
      accessorFn: currentStageLabel,
      size: 164,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Stage" />
      ),
      cell: ({ row }) => {
        const label = row.getValue<string>('stage')
        const current = row.original.stages.find(
          (entry) => entry.applicable && entry.status === 'pending',
        )
        return (
          <div className="flex items-center gap-2 overflow-hidden">
            <Badge variant={label === COMPLETED ? 'default' : 'secondary'}>
              {label}
            </Badge>
            {current?.assigneeName && (
              <span
                className="truncate text-xs text-muted-foreground"
                title={current.assigneeName}
              >
                {current.assigneeName}
              </span>
            )}
          </div>
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
      size: 80,
      meta: { label: 'Repairs' },
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
      size: 116,
      meta: { label: 'Balance Due' },
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
      meta: { label: 'Payment method' },
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
      size: 72,
      meta: { label: 'Actions' },
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
                  order.status === 'collected' ? 'Collected' : 'Mark Collected',
                icon: CheckIcon,
                disabled: order.status === 'collected',
                onClick: () => onCollect(order),
                separatorBefore: true,
              },
            ]}
          />
        )
      },
    },
  ])
}
