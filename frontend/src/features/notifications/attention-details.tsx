import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusBadge } from '@/components/status-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  attentionLabels,
  attentionLabel,
  attentionTones,
  needsDeliveryCheck,
  notificationTypeLabels,
} from './attention-labels'
import type { NotificationAttentionRow } from './types'

export function AttentionDetails({
  row,
  onClose,
  onPreview,
}: {
  row: NotificationAttentionRow
  onClose: () => void
  onPreview: (row: NotificationAttentionRow) => void
}) {
  const [checkedDelivery, setCheckedDelivery] = useState(false)
  const canPreview =
    row.eligible && row.status !== 'queued' && row.status !== 'delayed'
  const checkDelivery = needsDeliveryCheck(row)
  const recipients = row.previousVersion?.recipients ?? row.recipients
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {row.reference} · {notificationTypeLabels[row.kind]}
          </SheetTitle>
          <SheetDescription>
            Review delivery results and the recipients who still need this
            message.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-6 text-sm">
          <StatusBadge tone={attentionTones[row.status]}>
            {attentionLabel(row)}
          </StatusBadge>
          {row.previousVersion && (
            <div className="space-y-2">
              <p>
                The content changed since the last approved send. Preview and
                approve the updated message before sending it.
              </p>
              <p className="font-medium">
                Previous version: {attentionLabels[row.previousVersion.status]}
              </p>
            </div>
          )}
          {checkDelivery && (
            <div className="space-y-3 rounded-lg border p-3">
              <p>
                WhatsApp may have received this message. Check delivery before
                sending again to avoid a duplicate.
              </p>
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={checkedDelivery}
                  onCheckedChange={setCheckedDelivery}
                />
                I checked delivery and another message is needed.
              </label>
            </div>
          )}
          {row.status === 'delayed' && (
            <p>
              This message has been queued for over 30 minutes. It may be
              waiting for an automatic retry. Check the delivery service before
              sending again.
            </p>
          )}
          {row.status === 'accepted' && (
            <p>
              WhatsApp accepted this message. Delivery has not yet been
              confirmed.
            </p>
          )}
          {!row.eligible && (
            <p>
              This message no longer requires action. The order may have been
              collected or reopened, or notifications may have been disabled.
            </p>
          )}
          {row.lastAttemptAt && (
            <p className="text-muted-foreground">
              Last approved send: {new Date(row.lastAttemptAt).toLocaleString()}
            </p>
          )}
          {(row.previousVersion?.errorMessage || row.errorMessage) && (
            <p className="whitespace-pre-wrap text-destructive">
              {row.previousVersion?.errorMessage || row.errorMessage}
            </p>
          )}
          {row.repairReason && (
            <p>
              <span className="font-medium">Repair: </span>
              {row.repairReason}
            </p>
          )}
          {recipients.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium">
                {row.previousVersion
                  ? 'Previous version: latest result per recipient'
                  : 'Latest result per recipient'}
              </h3>
              {recipients.map((recipient) => (
                <div
                  key={recipient.id}
                  className="space-y-1 rounded-lg border p-3"
                >
                  <p className="font-medium">
                    {recipient.customers.map((c) => c.name).join(', ')}
                  </p>
                  <p dir="ltr" className="text-muted-foreground">
                    {recipient.normalizedMobile}
                  </p>
                  <p>
                    {recipient.status === 'accepted'
                      ? 'Accepted by WhatsApp'
                      : recipient.status === 'read'
                        ? 'Read'
                        : recipient.status.charAt(0).toUpperCase() +
                          recipient.status.slice(1)}
                  </p>
                  {recipient.errorMessage && (
                    <p className="text-destructive">{recipient.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {(row.deliveredCount > 0 || row.acceptedCount > 0) &&
            row.needsAttention && (
              <p className="text-muted-foreground">
                Some recipients already received or have a pending message.
                Review the recipient selection in the preview before resending.
              </p>
            )}
        </div>
        <SheetFooter>
          {canPreview && (
            <Button
              disabled={checkDelivery && !checkedDelivery}
              onClick={() => onPreview(row)}
            >
              {row.previousVersion
                ? 'Preview updated message'
                : row.notificationId
                  ? 'Preview resend'
                  : 'Preview & send'}
            </Button>
          )}
          {row.kind === 'repair_ready' && row.orderId ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link to="/orders/$orderId" params={{ orderId: row.orderId }} />
              }
            >
              Open order repairs
            </Button>
          ) : row.kind === 'gift_card' && row.giftCardCode ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  to="/gift-cards/$code"
                  params={{ code: row.giftCardCode }}
                />
              }
            >
              Open gift card
            </Button>
          ) : (
            row.invoiceId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: row.invoiceId }}
                  />
                }
              >
                Open invoice
              </Button>
            )
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
