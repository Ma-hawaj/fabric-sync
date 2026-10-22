import { ReadinessBadge } from '@/features/notifications/readiness-controls'
import type { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  FileDownIcon,
  CheckIcon,
  PencilIcon,
  WalletIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import { CURRENCY } from '@/lib/currency'
import type { Invoice, PaymentStatus } from '../types/invoices'

const paymentTypeLabels: Record<
  NonNullable<Invoice['paymentMethod']>,
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
  receivingOptions: { label: string; value: string }[],
  productionOptions: { label: string; value: string }[],
  onCollect: (invoice: Invoice) => void,
  onViewDetails: (invoice: Invoice) => void,
  onExportPdf: (invoice: Invoice) => void,
  onEdit: (invoice: Invoice) => void,
  onRecordPayment: (invoice: Invoice) => void,
  onResend?: (invoice: Invoice) => void,
): ColumnDef<Invoice, any>[] => [
  {
    id: 'expand',
    minSize: 48,
    meta: { label: 'Expand' },
    header: () => <span className="sr-only">Order breakdown</span>,
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={`${row.getIsExpanded() ? 'Hide' : 'Show'} orders for invoice INV-${row.original.invoiceNumber}`}
          aria-expanded={row.getIsExpanded()}
          aria-controls={`invoice-orders-${row.original.id}`}
          onClick={row.getToggleExpandedHandler()}
        >
          {row.getIsExpanded() ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
      ) : null,
    enableSorting: false,
    enableHiding: false,
    size: 40,
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
        params={{ invoiceId: row.original.id }}
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
    id: 'date',
    accessorFn: (invoice) => new Date(invoice.date),
    size: 154,
    meta: { label: 'Date' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Date" />
    ),
    cell: ({ row }) => {
      const value = row.getValue<Date>('date')
      return (
        <div className="leading-tight">
          <div>
            {value.toLocaleDateString(undefined, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {value.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      )
    },
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'targetDate',
    accessorFn: (invoice) =>
      invoice.targetDate ? new Date(invoice.targetDate) : null,
    size: 128,
    meta: { label: 'Target date' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Target Date" />
    ),
    cell: ({ row }) => {
      const value = row.getValue<Date | null>('targetDate')
      return <div>{value ? value.toLocaleDateString() : '—'}</div>
    },
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'customerName',
    accessorFn: (invoice) => invoice.customers.map((c) => c.name).join(', '),
    size: 190,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Customers" />
    ),
    cell: ({ row }) => (
      <div className="min-w-40 space-y-2">
        {row.original.customers.length === 0 ? (
          <span className="text-muted-foreground">Walk-in customer</span>
        ) : (
          row.original.customers.map((customer) => (
            <div key={JSON.stringify([customer.name, customer.mobileNo])}>
              <div className="font-medium">{customer.name}</div>
              <div dir="ltr" className="text-xs text-muted-foreground">
                {customer.mobileNo}
              </div>
            </div>
          ))
        )}
      </div>
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
    accessorKey: 'collected',
    size: 132,
    meta: { label: 'Collected' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Collected" />
    ),
    cell: ({ row }) => {
      const { orderCount, collectedOrderCount } = row.original
      if (orderCount === 0)
        return (
          <span className="text-muted-foreground">No tailoring orders</span>
        )
      return (
        <Badge
          variant={collectedOrderCount === orderCount ? 'default' : 'secondary'}
        >
          {collectedOrderCount} of {orderCount} collected
        </Badge>
      )
    },
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'customerMobile',
    accessorFn: (invoice) =>
      invoice.customers.map((c) => c.mobileNo).join(', '),
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
    accessorKey: 'itemCount',
    size: 80,
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
    size: 180,
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
    meta: {
      label: 'Materials',
      placeholder: 'Filter materials...',
      variant: 'multiSelect',
      options: materialOptions,
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
    accessorKey: 'productionLocations',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Production" />
    ),
    cell: ({ row }) => {
      const locations = row.getValue<string[]>('productionLocations')
      if (locations.length === 0)
        return <div className="text-muted-foreground">—</div>
      return (
        <div className="flex flex-wrap gap-1">
          {locations.map((location) => (
            <Badge key={location} variant="outline">
              {location}
            </Badge>
          ))}
        </div>
      )
    },
    enableSorting: false,
    enableColumnFilter: true,
    meta: {
      label: 'Production',
      placeholder: 'Filter production...',
      variant: 'multiSelect',
      options: productionOptions,
    },
  },
  {
    accessorKey: 'paymentStatus',
    size: 120,
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
    // The most recent payment's method, worked out server-side from the
    // ledger.
    accessorFn: (invoice) => invoice.paymentMethod,
    meta: { label: 'Payment method' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Payment Method" />
    ),
    cell: ({ row }) => {
      const type = row.getValue<Invoice['paymentMethod']>('paymentMethod')
      return <div>{type ? paymentTypeLabels[type] : '—'}</div>
    },
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'lastCollectedAt',
    accessorFn: (invoice) =>
      invoice.lastCollectedAt ? new Date(invoice.lastCollectedAt) : null,
    meta: { label: 'Last collected' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Last Collected" />
    ),
    cell: ({ row }) => {
      const lastCollected = row.getValue<Date | null>('lastCollectedAt')
      if (!lastCollected) return <div className="text-muted-foreground">—</div>
      return <div>{lastCollected.toLocaleString()}</div>
    },
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    accessorKey: 'amountPaid',
    size: 116,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Paid" />
    ),
    cell: ({ row }) => (
      <div className="text-end tabular-nums">
        {currencyFormatter.format(row.original.amountPaid)}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    meta: { label: 'Paid', variant: 'range', unit: CURRENCY, align: 'end' },
  },
  {
    accessorKey: 'balanceDue',
    size: 116,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Balance" />
    ),
    cell: ({ row }) => (
      <div
        className={
          row.original.balanceDue > 0
            ? 'font-semibold text-warning text-end tabular-nums'
            : 'text-end tabular-nums text-muted-foreground'
        }
      >
        {currencyFormatter.format(row.original.balanceDue)}
      </div>
    ),
    enableSorting: false,
    enableColumnFilter: false,
    meta: { label: 'Balance', align: 'end' },
  },
  {
    accessorKey: 'totalPrice',
    size: 116,
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
    meta: {
      label: 'Total Price',
      variant: 'range',
      range: [0, 2000],
      unit: CURRENCY,
    },
  },
  {
    id: 'readinessStatus',
    accessorKey: 'readinessStatus',
    size: 140,
    header: 'Readiness',
    cell: ({ row }) => <ReadinessBadge {...row.original} />,
    enableSorting: false,
    enableColumnFilter: true,
    meta: {
      label: 'Readiness',
      variant: 'multiSelect',
      options: [
        { label: 'In progress', value: 'in_progress' },
        { label: 'Partially ready', value: 'partially_ready' },
        { label: 'Ready for pickup', value: 'ready' },
        { label: 'Collected', value: 'collected' },
        { label: 'No garments', value: 'not_applicable' },
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
      const invoice = row.original
      return (
        <RowActions
          items={[
            {
              label: 'Resend invoice via WhatsApp',
              icon: FileDownIcon,
              onClick: () => onResend?.(invoice),
            },
            {
              label: 'View Details',
              icon: EyeIcon,
              onClick: () => onViewDetails(invoice),
            },
            {
              label: 'Export PDF',
              icon: FileDownIcon,
              onClick: () => onExportPdf(invoice),
            },
            {
              // Collected garments can't be re-specified: the backend refuses
              // to rebuild an invoice with collected orders, so the action is
              // disabled rather than failing on save. Advances don't block —
              // the ledger survives a rebuild untouched.
              label: 'Edit',
              icon: PencilIcon,
              disabled: invoice.collected || invoice.collectedOrderCount > 0,
              onClick: () => onEdit(invoice),
            },
            {
              // Money without collecting anything: an advance now, or the
              // remainder after everything was already collected. Disabled
              // once nothing is left to pay.
              label: 'Record Payment',
              icon: WalletIcon,
              disabled: invoice.balanceDue <= 0,
              onClick: () => onRecordPayment(invoice),
              separatorBefore: true,
            },
            {
              // Always available: on a paid invoice this just collects the
              // orders without taking money.
              label: 'Mark Collected',
              icon: CheckIcon,
              onClick: () => onCollect(invoice),
            },
          ]}
        />
      )
    },
  },
]
