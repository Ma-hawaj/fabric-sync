import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { NotificationDialog } from './notification-dialog'
import type { NotificationDraft, NotificationHistoryRow } from './types'

export function NotificationHistory({ invoiceId }: { invoiceId: string }) {
  const [resend, setResend] = React.useState<NotificationHistoryRow | null>(
    null,
  )
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
      {query.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No notifications yet.</p>
      )}
      {query.data?.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              {row.kind.replaceAll('_', ' ')} · {row.state}
            </p>
            <p className="text-muted-foreground">
              {new Date(row.createdAt).toLocaleString()} · {row.recipientCount}{' '}
              selected · {row.acceptedCount} accepted · {row.deliveredCount}{' '}
              delivered · {row.failedCount} failed · {row.uncertainCount}{' '}
              uncertain
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setResend(row)}>
            Preview resend
          </Button>
          <DeliveryDetails id={row.id} />
        </div>
      ))}
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
      className="w-full"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted-foreground">
        Delivery details
      </summary>
      {query.isLoading && <p>Loading delivery status…</p>}
      {query.isError && <p>Could not load delivery status.</p>}
      {query.data?.recipients.map((recipient) => (
        <div key={recipient.id} className="mt-2 rounded border p-2">
          <p>
            {recipient.customers.map((customer) => customer.name).join(', ')} ·{' '}
            <span dir="ltr">{recipient.normalizedMobile}</span> ·{' '}
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
