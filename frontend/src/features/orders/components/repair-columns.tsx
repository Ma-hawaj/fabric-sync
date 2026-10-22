import type { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { CheckIcon, FileDownIcon, LinkIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
import { CURRENCY } from '@/lib/currency'
import { isRepairFinished, repairStatusLabel } from '../lib/order-tracking'
import type { RepairListItem } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

// Shared by the status column: the toolbar hands over a string[] and an empty
// selection means "no filter".
function matchesAnySelected(cellValue: string[], filterValue: unknown) {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  return (filterValue as string[]).some((value) => cellValue.includes(value))
}

const statusOptions = [
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Ready', value: 'completed' },
  { label: 'Collected', value: 'received' },
  { label: 'Cancelled', value: 'cancelled' },
]

export function getRepairColumns(
  onReceive: (repair: RepairListItem) => void,
  onPrint: (repair: RepairListItem) => void,
): ColumnDef<RepairListItem, any>[] {
  return [
    {
      accessorKey: 'orderNumber',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Order" />
      ),
      cell: ({ row }) => (
        <Link
          to="/orders/$orderId"
          params={{ orderId: row.original.orderId }}
          className="font-mono font-medium text-info hover:underline"
        >
          ORD-{row.getValue<number>('orderNumber')}
        </Link>
      ),
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: (row, columnId, filterValue) => {
        const val = row.getValue<number>(columnId)
        return String(val).includes(String(filterValue))
      },
      meta: {
        label: 'Order',
        placeholder: 'Filter order...',
        variant: 'number',
      },
    },
    {
      accessorKey: 'customerName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Customer" />
      ),
      cell: ({ row }) => <div>{row.getValue('customerName')}</div>,
      enableSorting: true,
      enableColumnFilter: true,
      filterFn: (row, columnId, filterValue) => {
        const val = row.getValue<string>(columnId)
        return val.toLowerCase().includes(String(filterValue).toLowerCase())
      },
      meta: {
        label: 'Customer',
        placeholder: 'Filter customer...',
        variant: 'text',
      },
    },
    {
      accessorKey: 'reason',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Reason" />
      ),
      cell: ({ row }) => (
        <div className="max-w-56 truncate">{row.getValue('reason')}</div>
      ),
      enableSorting: false,
      enableColumnFilter: true,
      filterFn: (row, columnId, filterValue) => {
        const val = row.getValue<string>(columnId)
        return val.toLowerCase().includes(String(filterValue).toLowerCase())
      },
      meta: {
        label: 'Reason',
        placeholder: 'Filter reason...',
        variant: 'text',
      },
    },
    {
      accessorKey: 'reportedOn',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Reported" />
      ),
      cell: ({ row }) => (
        <div>
          {new Date(row.getValue<string>('reportedOn')).toLocaleDateString()}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: false,
    },
    {
      id: 'status',
      accessorFn: (repair) => [repair.status],
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Status" />
      ),
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <Badge variant={isRepairFinished(status) ? 'outline' : 'secondary'}>
            {repairStatusLabel(status)}
          </Badge>
        )
      },
      enableSorting: false,
      enableColumnFilter: true,
      filterFn: (row, columnId, filterValue) =>
        matchesAnySelected(row.getValue<string[]>(columnId), filterValue),
      meta: {
        label: 'Status',
        placeholder: 'Filter status...',
        variant: 'multiSelect',
        options: statusOptions,
      },
    },
    {
      accessorKey: 'charge',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Charge" />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {currencyFormatter.format(row.getValue<number>('charge'))}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: false,
    },
    {
      id: 'handover',
      accessorFn: (repair) =>
        repair.status === 'received'
          ? `Collected ${currencyFormatter.format(repair.receivedAmount)}`
          : repair.fixedMeasurementId
            ? 'Fix recorded'
            : '—',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Handover" />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground">
          {row.getValue<string>('handover')}
        </div>
      ),
      enableSorting: false,
      enableColumnFilter: false,
    },
    {
      id: 'actions',
      header: 'Actions',
      enablePinning: true,
      cell: ({ row }) => {
        const repair = row.original
        const canReceive = repair.status === 'completed'
        return (
          <RowActions
            items={[
              {
                label: 'Open order',
                icon: LinkIcon,
                render: (
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: repair.orderId }}
                  />
                ),
              },
              {
                label: 'Collect',
                icon: CheckIcon,
                disabled: !canReceive,
                onClick: () => onReceive(repair),
                separatorBefore: true,
              },
              {
                label: 'Print receipt',
                icon: FileDownIcon,
                onClick: () => onPrint(repair),
              },
            ]}
          />
        )
      },
    },
  ]
}
