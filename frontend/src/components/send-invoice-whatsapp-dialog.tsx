import * as React from 'react'
import { toast } from 'sonner'
import { FileTextIcon, Loader2Icon, MessageCircleIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CURRENCY } from '@/lib/currency'
import { ApiError } from '@/lib/api'
import {
  printInvoiceDocument,
  printReadyCardDocument,
} from '@/features/invoices/lib/print-invoice'
import { useInvoice } from '@/features/invoices/hooks/use-invoice'
import { useSendInvoiceWhatsApp } from '@/features/invoices/hooks/use-send-invoice-whatsapp'
import {
  captureInvoiceImagePng,
  captureReadyCardImagePng,
} from '@/features/invoices/lib/capture-invoice-image'
import { normalizePhoneNumber } from '@/lib/whatsapp'
import type {
  InvoiceDetail,
  InvoiceParty,
} from '@/features/invoices/types/invoice-detail'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

interface SendInvoiceWhatsAppDialogProps {
  /** Null keeps the dialog closed, which also holds `useInvoice` off. */
  invoiceId: string | null
  /** The occasion — only affects the copy shown. */
  kind: 'created' | 'ready' | 'resent'
  onOpenChange: (open: boolean) => void
}

/**
 * Sends a rendered image to the customer through WhatsApp. For a new or
 * re-sent invoice that is the invoice document; when the last order is ready
 * for collection it is instead the ready-for-collection card. The exact PNG
 * that will be sent is captured in the browser and shown before Send, so the
 * operator can review it (or open the same document as a PDF to print) first,
 * then posted to the backend, which sends it via the WhatsApp Business Cloud
 * API — the image lands in the customer's chat, no operator handoff.
 */
export function SendInvoiceWhatsAppDialog({
  invoiceId,
  kind,
  onOpenChange,
}: SendInvoiceWhatsAppDialogProps) {
  const { data: detail } = useInvoice(invoiceId)
  const send = useSendInvoiceWhatsApp()
  const isReady = kind === 'ready'
  const [chosenMobile, setChosenMobile] = React.useState('')
  const [preview, setPreview] = React.useState<{
    url: string
    blob: Blob
  } | null>(null)
  const [captureStatus, setCaptureStatus] = React.useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const previewUrlRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    setChosenMobile('')
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreview(null)
    setCaptureStatus('idle')

    if (!invoiceId) return
    let cancelled = false
    setCaptureStatus('loading')
    const capture = isReady
      ? captureReadyCardImagePng(invoiceId)
      : captureInvoiceImagePng(invoiceId)
    capture
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        previewUrlRef.current = url
        setPreview({ url, blob })
        setCaptureStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setCaptureStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [invoiceId, kind])

  // Revoke the preview URL when the dialog is torn down for good.
  React.useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const recipients = detail ? invoiceRecipients(detail) : []
  // Default to the first number on the invoice; the picker is only relevant
  // once there is more than one recipient.
  const recipientMobile = chosenMobile || recipients[0]?.mobileNo || ''

  const openPdf = async () => {
    if (!detail) return
    try {
      // The preview shows the exact document that will be sent, so the PDF
      // fallback must too — the ready card when the trigger is 'ready'.
      await (isReady
        ? printReadyCardDocument(detail.id)
        : printInvoiceDocument(detail.id))
    } catch {
      toast.error(
        isReady
          ? 'Could not open the ready card. Please try again.'
          : 'Could not open the invoice document. Please try again.',
      )
    }
  }

  const handleSend = async () => {
    if (!detail || !recipientMobile || !preview) return

    try {
      await send.mutateAsync({
        invoiceId: detail.id,
        to: recipientMobile,
        png: preview.blob,
      })
      toast.success(
        isReady
          ? 'Ready for collection — card sent via WhatsApp.'
          : 'Invoice sent via WhatsApp.',
      )
      onOpenChange(false)
    } catch (error) {
      // A backend rejection carries WhatsApp's own explanation (unverified
      // number, outside the 24-hour service window, revoked token…).
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Could not send the invoice. Please try again.',
      )
    }
  }

  return (
    <Dialog
      open={invoiceId !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent>
        {detail && (
          <>
            <DialogHeader>
              <DialogTitle>Send Invoice via WhatsApp</DialogTitle>
              <DialogDescription>
                Invoice {`INV-${detail.invoiceNumber}`}
                {isReady ? ' — ready for collection' : ''} — the
                {isReady
                  ? ' ready-for-collection card'
                  : ' invoice document'}{' '}
                is sent to the customer as an image.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Total</span>
                <span>{currencyFormatter.format(detail.totals.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Balance Due</span>
                <span>
                  {currencyFormatter.format(detail.totals.balanceDue)}
                </span>
              </div>
            </div>

            {recipients.length > 1 ? (
              <div className="space-y-1">
                <Label htmlFor="whatsapp-recipient">Recipient</Label>
                <Select
                  items={recipients.map((customer) => ({
                    value: customer.mobileNo,
                    label: `${customer.name} — ${customer.mobileNo}`,
                  }))}
                  value={recipientMobile || null}
                  onValueChange={(value) =>
                    setChosenMobile(value || recipients[0]?.mobileNo || '')
                  }
                >
                  <SelectTrigger id="whatsapp-recipient" className="w-full">
                    <SelectValue placeholder="Pick a recipient..." />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((customer) => (
                      <SelectItem
                        key={customer.mobileNo}
                        value={customer.mobileNo}
                      >
                        {customer.name} — {customer.mobileNo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              recipients[0] && (
                <div className="text-sm">
                  <span className="text-muted-foreground">To </span>
                  <span className="font-medium" dir="ltr">
                    {recipients[0].name} — {recipients[0].mobileNo}
                  </span>
                </div>
              )
            )}

            {recipients.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No phone number on file for this customer — nothing to send the
                invoice to.
              </p>
            )}

            <div className="space-y-2">
              {captureStatus === 'loading' && (
                <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {isReady
                    ? 'Preparing the ready card preview…'
                    : 'Preparing the invoice preview…'}
                </div>
              )}

              {captureStatus === 'error' && (
                <p className="text-sm text-muted-foreground">
                  {isReady
                    ? 'Could not prepare the ready card to send — open it as a PDF instead.'
                    : 'Could not prepare the invoice image to send — open it as a PDF instead.'}
                </p>
              )}

              {captureStatus === 'ready' && preview && (
                <img
                  src={preview.url}
                  alt={isReady ? 'Ready card preview' : 'Invoice preview'}
                  className="mx-auto max-h-72 w-auto rounded-md border bg-white shadow-sm"
                />
              )}

              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openPdf()}
                  disabled={captureStatus === 'loading'}
                >
                  <FileTextIcon className="h-4 w-4" />
                  {captureStatus === 'error'
                    ? 'Open PDF instead'
                    : 'Preview as PDF'}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={send.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleSend()}
                disabled={
                  !recipientMobile ||
                  send.isPending ||
                  captureStatus !== 'ready'
                }
              >
                <MessageCircleIcon className="h-4 w-4" />
                {send.isPending ? 'Sending…' : 'Send via WhatsApp'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The people to reach: the single retail buyer, or every named order customer. */
function invoiceRecipients(detail: InvoiceDetail): InvoiceParty[] {
  if (detail.buyer) return [detail.buyer]
  const seen = new Map<string, InvoiceParty>()
  for (const line of detail.lines) {
    if (line.customer && normalizePhoneNumber(line.customer.mobileNo)) {
      seen.set(line.customer.mobileNo, line.customer)
    }
  }
  return [...seen.values()]
}
