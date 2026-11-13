import { useMemo, useState } from 'react'
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { useDataTable } from '@/hooks/use-data-table'
import { useListParams } from '@/hooks/use-list-params'
import { getAttentionColumns } from './attention-columns'
import { AttentionDetails } from './attention-details'
import { NotificationDialog } from './notification-dialog'
import { SendGiftCardDialog } from '@/features/gift-cards/components/send-gift-card-dialog'
import {
  useNotificationAttention,
  useNotificationAttentionSummary,
} from './hooks/use-notification-attention'
import type { NotificationAttentionRow } from './types'

const views = [
  'attention',
  'not_sent',
  'failed',
  'uncertain',
  'delayed',
  'history',
] as const

export function NotificationsPage() {
  const [{ view }, setView] = useQueryStates({
    view: parseAsStringLiteral(views).withDefault('attention'),
    page: parseAsInteger.withDefault(1),
  })
  const [review, setReview] = useState<NotificationAttentionRow | null>(null)
  const [preview, setPreview] = useState<NotificationAttentionRow | null>(null)
  const columns = useMemo(
    () => getAttentionColumns({ onReview: setReview, onPreview: setPreview }),
    [],
  )
  const { searchParams } = useListParams({ columns })
  const request = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    const filters = JSON.parse(params.get('filters') ?? '[]') as object[]
    filters.push({
      id: 'needsAttention',
      value: view !== 'history',
      operator: 'eq',
      variant: 'boolean',
    })
    if (view !== 'attention' && view !== 'history') {
      filters.push({
        id: 'status',
        value: view,
        operator: 'eq',
        variant: 'select',
      })
    }
    params.set('filters', JSON.stringify(filters))
    params.set('joinOperator', 'and')
    return params
  }, [searchParams, view])
  const query = useNotificationAttention(request)
  const summary = useNotificationAttentionSummary()
  const { table } = useDataTable({
    data: query.data,
    columns,
    pageCount: query.pageCount,
    rowCount: query.total,
    getRowId: (row) => `${row.entityId}:${row.kind}`,
    initialState: {
      columnPinning: { left: ['reference'], right: ['actions'] },
      columnOrder: [
        'reference',
        'kind',
        'customerName',
        'status',
        'waitingSince',
        'branchName',
        'actions',
      ],
    },
  })
  const typeFilter = table.getColumn('kind')?.getFilterValue() as
    string[] | undefined
  const repairReadyOnly =
    typeFilter?.length === 1 && typeFilter[0] === 'repair_ready'
  const counts = summary.data
  const filters = [
    { view: 'attention', label: 'Needs attention', count: counts?.total },
    { view: 'not_sent', label: 'Not sent', count: counts?.notSent },
    { view: 'failed', label: 'Failed', count: counts?.failed },
    { view: 'uncertain', label: 'Check delivery', count: counts?.uncertain },
    { view: 'delayed', label: 'Waiting too long', count: counts?.delayed },
    { view: 'history', label: 'History', count: undefined },
  ] as const
  return (
    <div
      data-slot="list-page"
      className="flex h-full min-h-0 min-w-0 flex-col gap-5 [&>:first-child]:shrink-0"
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              Notifications
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Find missed notifications, review failures, and filter by
              notification type.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={query.isFetching || summary.isFetching}
            onClick={() => {
              void query.refetch()
              void summary.refetch()
            }}
          >
            <RefreshCwIcon className={query.isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Notification views"
        >
          {filters.map((item) => (
            <Button
              key={item.view}
              variant={view === item.view ? 'default' : 'outline'}
              size="sm"
              aria-pressed={view === item.view}
              aria-label={
                item.count === undefined
                  ? item.label
                  : `${item.label} ${item.count}`
              }
              onClick={() => void setView({ view: item.view, page: 1 })}
            >
              {item.label}
              {item.count !== undefined && (
                <span className="ms-1 tabular-nums">
                  {item.count.toLocaleString()}
                </span>
              )}
            </Button>
          ))}
        </div>
        {view === 'attention' && (
          <p className="text-xs text-muted-foreground">
            Oldest outstanding items appear first. Reminders follow new invoice
            and pickup actions; historical imports do not create a backlog.
            Queued or accepted messages appear in History.
          </p>
        )}
        {view === 'history' && (
          <p className="text-xs text-muted-foreground">
            Latest results for messages that do not currently need action.
            Accepted by WhatsApp does not confirm delivery.
          </p>
        )}
        {summary.isError && (
          <p role="alert" className="text-sm text-destructive">
            Notification counts could not be loaded. Refresh to try again.
          </p>
        )}
        {repairReadyOnly && (
          <p role="status" className="text-sm text-muted-foreground">
            Repair-ready notices are tracked separately for each repair,
            including repairs of collected orders.
          </p>
        )}
      </div>
      {query.isError ? (
        <div role="alert" className="rounded-lg border p-6 text-sm">
          <p>Notifications could not be loaded.</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <DataTable
          table={table}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
        >
          <DataTableToolbar table={table} />
          {!query.isLoading && query.total === 0 && (
            <p
              role="status"
              className="px-4 pb-3 text-sm text-muted-foreground"
            >
              {view === 'attention' && counts?.total === 0 && !repairReadyOnly
                ? 'No notifications need attention. You’re all caught up.'
                : 'No notifications match this view and its filters.'}
            </p>
          )}
        </DataTable>
      )}
      {review && (
        <AttentionDetails
          key={`${review.entityId}:${review.kind}`}
          row={
            query.data.find(
              (item) =>
                item.entityId === review.entityId && item.kind === review.kind,
            ) ?? review
          }
          onClose={() => setReview(null)}
          onPreview={(row) => {
            setReview(null)
            setPreview(row)
          }}
        />
      )}
      <NotificationDialog
        invoiceId={
          preview?.kind === 'gift_card' ? null : (preview?.invoiceId ?? null)
        }
        kind={
          preview?.kind === 'invoice_ready' || preview?.kind === 'repair_ready'
            ? 'invoice_ready'
            : preview?.previousVersion
              ? 'invoice_updated'
              : preview?.notificationId
                ? 'manual_resend'
                : 'invoice_created'
        }
        resendOf={preview?.notificationId ?? undefined}
        repairId={preview?.repairId ?? undefined}
        onClose={() => setPreview(null)}
      />
      {preview?.kind === 'gift_card' &&
        preview.giftCardId &&
        preview.giftCardCode && (
          <SendGiftCardDialog
            card={{ id: preview.giftCardId, code: preview.giftCardCode }}
            onClose={() => setPreview(null)}
          />
        )}
    </div>
  )
}
