import { BanIcon, RotateCcwIcon } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { CURRENCY } from '@/lib/currency'
import { giftCardStatus } from '../lib/gift-card-status'
import type { GiftCard } from '../types/gift-card'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

function amountRangeFilter(cellValue: number, filterValue: unknown) {
  if (!Array.isArray(filterValue)) return true
  const [minVal, maxVal] = filterValue
  const min = minVal != null ? Number(minVal) : undefined
  const max = maxVal != null ? Number(maxVal) : undefined
  if (min !== undefined && !isNaN(min) && cellValue < min) return false
  if (max !== undefined && !isNaN(max) && cellValue > max) return false
  return true
}

function matchesAnySelected(cellValue: string[], filterValue: unknown) {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  return (filterValue as string[]).some((value) => cellValue.includes(value))
}

export const getGiftCardColumns = (
  onToggleActive: (card: GiftCard) => void,
  isToggling: boolean,
  today: string,
): ColumnDef<GiftCard, any>[] => [
  {
    accessorKey: 'code',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Code" />
    ),
    cell: ({ row }) => (
      <div className="font-mono font-medium">{row.getValue('code')}</div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      row
        .getValue<string>(columnId)
        .toLowerCase()
        .includes(String(filterValue).toLowerCase()),
    meta: {
      label: 'Code',
      placeholder: 'Filter code...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'initialAmount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Issued For" />
    ),
    cell: ({ row }) => (
      <div className="text-muted-foreground">
        {currencyFormatter.format(row.getValue<number>('initialAmount'))}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    accessorKey: 'balance',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Balance" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {currencyFormatter.format(row.getValue<number>('balance'))}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      amountRangeFilter(row.getValue<number>(columnId), filterValue),
    meta: {
      label: 'Balance',
      variant: 'range',
      range: [0, 2000],
      unit: CURRENCY,
    },
  },
  {
    id: 'customerName',
    accessorFn: (card) => card.customerName ?? '',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Bought By" />
    ),
    cell: ({ row }) => (
      <div>
        {row.original.customerName ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: true,
    filterFn: (row, columnId, filterValue) =>
      row
        .getValue<string>(columnId)
        .toLowerCase()
        .includes(String(filterValue).toLowerCase()),
    meta: {
      label: 'Bought By',
      placeholder: 'Filter customer...',
      variant: 'text',
    },
  },
  {
    accessorKey: 'expiresOn',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Expires" />
    ),
    cell: ({ row }) => (
      <div className="text-muted-foreground">
        {row.original.expiresOn ?? 'Never'}
      </div>
    ),
    enableSorting: true,
    enableColumnFilter: false,
  },
  {
    id: 'status',
    accessorFn: (card) => [giftCardStatus(card, today)],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Status" />
    ),
    cell: ({ row }) => {
      const status = giftCardStatus(row.original, today)
      // Only a spendable card gets the filled badge; the three ways a card
      // can be unusable all read as muted outlines.
      return status === 'Active' ? (
        <Badge variant="secondary">Active</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          {status}
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
      options: [
        { label: 'Active', value: 'Active' },
        { label: 'Spent', value: 'Spent' },
        { label: 'Expired', value: 'Expired' },
        { label: 'Voided', value: 'Voided' },
      ],
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        disabled={isToggling}
        onClick={() => onToggleActive(row.original)}
        className="h-8 w-auto px-2"
      >
        {row.original.isActive ? (
          <BanIcon className="mr-1.5 h-4 w-4" />
        ) : (
          <RotateCcwIcon className="mr-1.5 h-4 w-4" />
        )}
        {row.original.isActive ? 'Void' : 'Restore'}
      </Button>
    ),
  },
]
