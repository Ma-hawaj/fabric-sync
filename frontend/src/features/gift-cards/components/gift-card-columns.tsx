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
    meta: {
      label: 'Status',
      placeholder: 'Filter status...',
      variant: 'multiSelect',
      // Values are the tokens the API's derived `status` column emits; the
      // labels stay the words staff read.
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Spent', value: 'spent' },
        { label: 'Expired', value: 'expired' },
        { label: 'Voided', value: 'voided' },
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
