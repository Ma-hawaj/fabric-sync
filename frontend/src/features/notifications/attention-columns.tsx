import { formatDistanceToNow } from 'date-fns'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { defineColumns } from '@/lib/define-columns'
import {
  attentionLabels,
  attentionLabel,
  attentionTones,
  needsDeliveryCheck,
  notificationTypeLabels,
  notificationTypeOptions,
  unsentNotificationLabels,
} from './attention-labels'
import type { NotificationAttentionRow } from './types'

function NotificationReference({ item }: { item: NotificationAttentionRow }) {
  const linkClass = 'font-mono font-medium text-info hover:underline'
  return (
    <div className="space-y-1">
      {item.kind === 'repair_ready' && item.orderId ? (
        <Link
          className={linkClass}
          to="/orders/$orderId"
          params={{ orderId: item.orderId }}
        >
          {item.reference}
        </Link>
      ) : item.kind === 'gift_card' && item.giftCardCode ? (
        <Link
          className={linkClass}
          to="/gift-cards/$code"
          params={{ code: item.giftCardCode }}
        >
          {item.reference}
        </Link>
      ) : item.invoiceId ? (
        <Link
          className={linkClass}
          to="/invoices/$invoiceId"
          params={{ invoiceId: item.invoiceId }}
        >
          {item.reference}
        </Link>
      ) : (
        item.reference
      )}
      <p className="text-xs text-muted-foreground sm:hidden">
        {notificationTypeLabels[item.kind]}
      </p>
    </div>
  )
}

export function getAttentionColumns({
  onReview,
  onPreview,
}: {
  onReview: (row: NotificationAttentionRow) => void
  onPreview: (row: NotificationAttentionRow) => void
}) {
  return defineColumns<NotificationAttentionRow>()([
    {
      accessorKey: 'reference',
      size: 150,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Reference" />
      ),
      cell: ({ row }) => <NotificationReference item={row.original} />,
      enableColumnFilter: true,
      meta: {
        label: 'Reference',
        variant: 'text',
        placeholder: 'Invoice or gift card…',
      },
    },
    {
      id: 'customerName',
      accessorFn: (row) => row.customers.map((c) => c.name).join(', '),
      size: 220,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Customer" />
      ),
      cell: ({ row }) => (
        <div className="space-y-1">
          {row.original.customers.map((c) => (
            <div key={c.id}>
              <p className="font-medium">{c.name}</p>
              <p dir="ltr" className="text-xs text-muted-foreground">
                {c.mobileNo || 'No mobile number'}
              </p>
            </div>
          ))}
        </div>
      ),
      enableColumnFilter: true,
      meta: {
        label: 'Customer',
        variant: 'text',
        placeholder: 'Search customer…',
      },
    },
    {
      accessorKey: 'kind',
      size: 160,
      header: 'Notification type',
      cell: ({ row }) => notificationTypeLabels[row.original.kind],
      enableColumnFilter: true,
      enableHiding: false,
      meta: {
        label: 'Notification type',
        variant: 'multiSelect',
        options: notificationTypeOptions,
      },
    },
    {
      accessorKey: 'status',
      size: 235,
      header: 'Status',
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="space-y-1.5">
            <StatusBadge tone={attentionTones[item.status]}>
              {attentionLabel(item)}
            </StatusBadge>
            {item.previousVersion && (
              <button
                className="block max-w-full whitespace-normal text-start text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                onClick={() => onReview(item)}
              >
                Previous version: {attentionLabels[item.previousVersion.status]}
              </button>
            )}
            {item.status === 'failed' && (
              <p className="text-xs text-muted-foreground">
                {item.failedCount} of {item.recipientCount} recipients failed
              </p>
            )}
            {item.status === 'delivered' && (
              <p className="text-xs text-muted-foreground">
                {item.deliveredCount} of {item.recipientCount} delivered
              </p>
            )}
            {item.status === 'not_sent' && !item.previousVersion && (
              <p className="text-xs text-muted-foreground">
                {unsentNotificationLabels[item.kind]}
              </p>
            )}
            {item.errorMessage && item.status !== 'not_sent' && (
              <p
                className="max-w-56 truncate text-xs text-muted-foreground"
                title={item.errorMessage}
              >
                {item.errorMessage}
              </p>
            )}
          </div>
        )
      },
      enableColumnFilter: false,
      meta: { label: 'Status' },
    },
    {
      accessorKey: 'waitingSince',
      size: 165,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Waiting since" />
      ),
      cell: ({ row }) => (
        <time
          dateTime={row.original.waitingSince}
          title={new Date(row.original.waitingSince).toLocaleString()}
        >
          {formatDistanceToNow(new Date(row.original.waitingSince), {
            addSuffix: true,
          })}
        </time>
      ),
      enableColumnFilter: true,
      meta: { label: 'Waiting since', variant: 'dateRange' },
    },
    {
      accessorKey: 'branchName',
      size: 160,
      header: 'Branch',
      cell: ({ row }) => row.original.branchName ?? '—',
      enableColumnFilter: true,
      meta: { label: 'Branch', variant: 'text', placeholder: 'Filter branch…' },
    },
    {
      id: 'actions',
      size: 135,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            row.original.status === 'not_sent' &&
            row.original.eligible &&
            !needsDeliveryCheck(row.original)
              ? onPreview(row.original)
              : onReview(row.original)
          }
        >
          {row.original.status === 'not_sent' &&
          row.original.eligible &&
          !needsDeliveryCheck(row.original)
            ? row.original.previousVersion
              ? 'Preview update'
              : 'Preview & send'
            : 'Review'}
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { label: 'Actions' },
    },
  ])
}
