import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NotificationDialog } from './notification-dialog'

export interface ReadinessFields {
  readinessStatus?: string
  readyOrderCount?: number
  pendingOrderCount?: number
  readinessGeneration?: number
}
export const readinessLabels: Record<string, string> = {
  not_applicable: 'Not applicable',
  collected: 'Collected',
  ready: 'Ready for pickup',
  partially_ready: 'Partially ready',
  in_progress: 'In progress',
}
export function ReadinessBadge({
  readinessStatus,
  readyOrderCount,
  pendingOrderCount,
}: ReadinessFields) {
  if (!readinessStatus || readinessStatus === 'not_applicable') return null
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant={readinessStatus === 'ready' ? 'default' : 'outline'}>
        {readinessLabels[readinessStatus] ?? readinessStatus}
      </Badge>
      {readinessStatus !== 'collected' && (
        <span className="text-xs text-muted-foreground">
          {readyOrderCount ?? 0} ready · {pendingOrderCount ?? 0} in production
        </span>
      )}
    </span>
  )
}

interface Props {
  id: string
  invoiceId: string
  scope: 'orders' | 'invoices'
  status: string
  readyAt?: string | null
  readyBy?: string | null
}
export function ReadinessControls({
  id,
  invoiceId,
  scope,
  status,
  readyAt,
  readyBy,
}: Props) {
  const client = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [notify, setNotify] = React.useState(false)
  const reopening = scope === 'orders' && status === 'ready'
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<{ becameReady?: boolean }>(
          `/${scope}/${id}/${reopening ? 'reopen' : 'ready'}`,
          reopening ? { reason } : { confirmedAtPickupBranch: confirmed },
        )
      ).data,
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['orders'] })
      void client.invalidateQueries({ queryKey: ['invoices'] })
      setOpen(false)
      setConfirmed(false)
      if (result.becameReady) setNotify(true)
    },
  })
  if (
    status === 'received' ||
    status === 'collected' ||
    status === 'not_applicable'
  )
    return null
  if (scope === 'invoices' && status === 'ready')
    return (
      <>
        <Button variant="outline" onClick={() => setNotify(true)}>
          Notify ready for pickup
        </Button>
        <NotificationDialog
          invoiceId={notify ? invoiceId : null}
          kind="invoice_ready"
          onClose={() => setNotify(false)}
        />
      </>
    )
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          mutation.reset()
          setOpen(true)
        }}
      >
        {reopening
          ? 'Reopen production'
          : scope === 'invoices'
            ? 'Mark remaining orders ready'
            : 'Mark ready for pickup'}
      </Button>
      {readyAt && (
        <span className="text-xs text-muted-foreground">
          Ready {new Date(readyAt).toLocaleString()}
          {readyBy ? ` · ${readyBy}` : ''}
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reopening ? 'Reopen production' : 'Confirm ready for pickup'}
            </DialogTitle>
            <DialogDescription>
              {reopening
                ? 'This clears readiness and requires a fresh confirmation before a pickup notice can be sent.'
                : 'Production, repairs, and delivery to the pickup branch will be checked before marking ready.'}
            </DialogDescription>
          </DialogHeader>
          {reopening ? (
            <label className="space-y-2 text-sm">
              Reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="block min-h-24 w-full rounded border p-2"
              />
            </label>
          ) : (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I confirm the garments are available at the pickup branch.
            </label>
          )}
          {mutation.error && (
            <p
              role="alert"
              className="whitespace-pre-wrap text-sm text-destructive"
            >
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={
                mutation.isPending || (reopening ? !reason.trim() : !confirmed)
              }
            >
              {mutation.isPending
                ? 'Saving…'
                : reopening
                  ? 'Reopen production'
                  : 'Confirm ready'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NotificationDialog
        invoiceId={notify ? invoiceId : null}
        kind="invoice_ready"
        onClose={() => setNotify(false)}
      />
    </>
  )
}
