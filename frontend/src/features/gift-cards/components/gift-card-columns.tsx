import { BanIcon, RotateCcwIcon, SendIcon, PencilIcon } from 'lucide-react'
import { defineColumns } from '@/lib/define-columns'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { RowActions } from '@/components/data-table/row-actions'
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
  onEditRecipient: (card: GiftCard) => void,
  onSend: (card: GiftCard) => void,
) =>
  defineColumns<GiftCard>()([
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
      meta: { label: 'Initial Amount' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Value" />
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
      size: 190,
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
      accessorKey: 'boughtFor',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Bought For" />
      ),
      cell: ({ row }) => row.original.boughtFor || '—',
      enableColumnFilter: true,
      meta: {
        label: 'Bought For',
        placeholder: 'Filter recipient…',
        variant: 'text',
      },
    },
    {
      accessorKey: 'recipientPhone',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Recipient Phone" />
      ),
      cell: ({ row }) => row.original.recipientPhone || '—',
      enableColumnFilter: true,
      meta: {
        label: 'Recipient Phone',
        placeholder: 'Filter phone…',
        variant: 'text',
      },
    },
    {
      accessorKey: 'deliveryStatus',
      header: 'WhatsApp',
      cell: ({ row }) => (
        <div
          title={row.original.deliveryError ?? undefined}
          className="capitalize"
        >
          {row.original.deliveryStatus ?? 'Not sent'}
          {row.original.deliveryError && (
            <p className="max-w-64 text-xs normal-case text-destructive">
              {row.original.deliveryError}
            </p>
          )}
        </div>
      ),
      enableSorting: false,
      meta: { label: 'WhatsApp' },
    },
    {
      accessorKey: 'expiresOn',
      meta: { label: 'Expires On', variant: 'dateRange' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Expires" />
      ),
      cell: ({ row }) => (
        <div className="text-muted-foreground">
          {row.original.expiresOn ?? 'Never'}
        </div>
      ),
      enableSorting: true,
      enableColumnFilter: true,
    },
    {
      id: 'status',
      accessorFn: (card) => [giftCardStatus(card, today)],
      size: 96,
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
      size: 72,
      meta: { label: 'Actions' },
      header: 'Actions',
      enablePinning: true,
      cell: ({ row }) => {
        const card = row.original
        return (
          <RowActions
            items={[
              {
                label: 'Edit recipient',
                icon: PencilIcon,
                onClick: () => onEditRecipient(card),
              },
              {
                label: 'Send via WhatsApp',
                icon: SendIcon,
                disabled:
                  !card.recipientPhone ||
                  giftCardStatus(card, today) !== 'Active' ||
                  ['queued', 'sending'].includes(card.deliveryStatus ?? ''),
                onClick: () => onSend(card),
              },
              {
                label: card.isActive ? 'Void' : 'Restore',
                icon: card.isActive ? BanIcon : RotateCcwIcon,
                disabled: isToggling,
                destructive: card.isActive,
                onClick: () => onToggleActive(card),
              },
            ]}
          />
        )
      },
    },
  ])
