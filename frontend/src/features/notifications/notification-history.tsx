import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { NotificationDialog } from './notification-dialog'
import type { NotificationDraft, NotificationHistoryRow } from './types'

function deliverySummary(row: NotificationHistoryRow) {
  return [
    [row.queuedCount, 'queued'],
    [row.acceptedCount, 'accepted'],
    [row.deliveredCount, 'delivered'],
    [row.failedCount, 'failed'],
    [row.uncertainCount, 'uncertain'],
    [row.cancelledCount, 'cancelled'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ')
}

const kindLabels = {
  invoice_created: 'Invoice',
  invoice_updated: 'Updated invoice',
  manual_resend: 'Invoice resend',
  invoice_ready: 'Ready for pickup',
}

export function NotificationHistory({ invoiceId }: { invoiceId: string }) {
  const [resend, setResend] = React.useState<NotificationHistoryRow | null>(
    null,
  )
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const query = useQuery({
    queryKey: ['notifications', invoiceId],
    queryFn: async () =>
      (
        await apiClient.get<NotificationHistoryRow[]>(
          `/invoices/${invoiceId}/notifications`,
        )
      ).data,
    staleTime: 5000,
    refetchInterval: 10000,
  })
  const latestInvoice = query.data?.find((row) => row.kind !== 'invoice_ready')
  const latestReady = query.data?.find((row) => row.kind === 'invoice_ready')
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">WhatsApp notifications</h2>
      {query.isLoading && (
        <p className="text-sm text-muted-foreground">
          Loading notification history…
        </p>
      )}
      {query.isError && (
        <p className="text-sm text-muted-foreground">
          Notification history could not be loaded.
        </p>
      )}
      {query.data && (
        <>
          <div className="divide-y rounded-lg border px-3">
            {[
              { label: 'Invoice', row: latestInvoice },
              { label: 'Ready for pickup', row: latestReady },
            ].map(({ label, row }) => (
              <div
                key={label}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-muted-foreground">
                    {row ? deliverySummary(row) : 'Not sent'}
                  </p>
                  {row && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                {row && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResend(row)}
                  >
                    Preview resend
                  </Button>
                )}
              </div>
            ))}
          </div>
          {query.data.length > 0 && (
            <details
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm text-muted-foreground">
                View history ({query.data.length})
              </summary>
              {historyOpen && (
                <div className="mt-3 space-y-2">
                  {query.data.map((row) => (
                    <div key={row.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{kindLabels[row.kind]}</p>
                      <p className="text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()} ·{' '}
                        {deliverySummary(row)}
                      </p>
                      {row.state === 'stale' && (
                        <p className="text-muted-foreground">
                          Remaining deliveries cancelled after the invoice
                          changed.
                        </p>
                      )}
                      <DeliveryDetails id={row.id} />
                    </div>
                  ))}
                </div>
              )}
            </details>
          )}
        </>
      )}
      <NotificationDialog
        invoiceId={resend ? invoiceId : null}
        kind={
          resend?.kind === 'invoice_ready' ? 'invoice_ready' : 'manual_resend'
        }
        resendOf={resend?.id}
        onClose={() => setResend(null)}
      />
    </section>
  )
}

function DeliveryDetails({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false)
  const query = useQuery({
    queryKey: ['notification-delivery', id],
    queryFn: async () =>
      (await apiClient.get<NotificationDraft>(`/notifications/${id}`)).data,
    enabled: open,
    staleTime: 5000,
    refetchInterval: open ? 10000 : false,
  })
  return (
    <details
      className="mt-2"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted-foreground">
        Delivery details
      </summary>
      {query.isLoading && <p>Loading delivery status…</p>}
      {query.isError && <p>Could not load delivery status.</p>}
      {query.data?.recipients
        .filter((recipient) => recipient.selected)
        .map((recipient) => (
          <div key={recipient.id} className="mt-2 rounded border p-2">
            <p>
              {recipient.customers.map((customer) => customer.name).join(', ')}{' '}
              · <span dir="ltr">{recipient.normalizedMobile}</span> ·{' '}
              {recipient.status}
            </p>
            {recipient.errorMessage && (
              <p className="text-destructive">{recipient.errorMessage}</p>
            )}
          </div>
        ))}
    </details>
  )
}
