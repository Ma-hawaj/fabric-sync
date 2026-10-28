import { useAuth } from '@/lib/auth'
import { canAccess } from '@/lib/permissions'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { StaffName } from '@/features/users/components/staff-name'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NotificationDialog } from './notification-dialog'
import { useChangeReadiness } from './hooks/use-change-readiness'

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
  const { user } = useAuth()
  const canNotify = canAccess(user, 'POST', '/invoices/:id/notifications')
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(false)
  const reopening = scope === 'orders' && status === 'ready'
  const mutation = useChangeReadiness()
  if (
    !canAccess(user, 'POST', `/${scope}/:id/${reopening ? 'reopen' : 'ready'}`)
  )
    return null
  if (status === 'collected' || status === 'not_applicable') return null
  const notificationDialog = (
    <NotificationDialog
      key="ready-notification"
      invoiceId={notify ? invoiceId : null}
      kind="invoice_ready"
      onClose={() => setNotify(false)}
    />
  )
  if (scope === 'invoices' && status === 'ready' && !canNotify) return null
  if (scope === 'invoices' && status === 'ready')
    return (
      <>
        {notificationDialog}
        <Button variant="outline" onClick={() => setNotify(true)}>
          Notify ready for pickup
        </Button>
      </>
    )
  return (
    <>
      {notificationDialog}
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
          {readyBy && (
            <>
              {' '}
              · <StaffName userId={readyBy} />
            </>
          )}
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
              <Checkbox
                className="mt-0.5"
                checked={confirmed}
                disabled={mutation.isPending}
                onCheckedChange={setConfirmed}
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
              onClick={() =>
                mutation.mutate(
                  reopening
                    ? {
                        id,
                        scope: 'orders',
                        action: 'reopen',
                        body: { reason },
                      }
                    : {
                        id,
                        scope,
                        action: 'ready',
                        body: { confirmedAtPickupBranch: confirmed },
                      },
                  {
                    onSuccess: (result) => {
                      setOpen(false)
                      setConfirmed(false)
                      if (result.becameReady && canNotify) setNotify(true)
                    },
                  },
                )
              }
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
    </>
  )
}
