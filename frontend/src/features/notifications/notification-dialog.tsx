import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { NotificationDraft, NotificationKind } from './types'

interface Props {
  invoiceId: string | null
  kind: NotificationKind
  onClose: () => void
  resendOf?: string
}

export function NotificationDialog(props: Props) {
  return props.invoiceId ? (
    <Preview
      key={`${props.invoiceId}:${props.kind}:${props.resendOf ?? ''}`}
      {...props}
      invoiceId={props.invoiceId}
    />
  ) : null
}

function Preview({
  invoiceId,
  kind,
  onClose,
  resendOf,
}: Props & { invoiceId: string }) {
  const client = useQueryClient()
  const [requestId] = React.useState(() => crypto.randomUUID())
  const [draft, setDraft] = React.useState<NotificationDraft | null>(null)
  const [pdfPreview, setPdfPreview] = React.useState<{
    artifactId: string
    url: string
  } | null>(null)
  const pdfUrl =
    pdfPreview?.artifactId === draft?.artifactId
      ? (pdfPreview?.url ?? null)
      : null
  const [problem, setProblem] = React.useState('')
  const {
    mutate: prepare,
    isPending: preparing,
    error: prepareError,
  } = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<NotificationDraft>(
          `/invoices/${invoiceId}/notifications`,
          { kind, requestId, resendOf },
        )
      ).data,
    onSuccess: (value) => {
      setDraft(value)
      setProblem('')
    },
  })
  React.useEffect(() => {
    prepare()
  }, [prepare])
  const pdf = useQuery({
    queryKey: ['notification-document', draft?.artifactId],
    queryFn: async () =>
      (
        await apiClient.get<Blob>(`/documents/${draft?.artifactId}/content`, {
          responseType: 'blob',
        })
      ).data,
    enabled: Boolean(draft?.artifactId),
    staleTime: Infinity,
    gcTime: 0,
  })
  React.useEffect(() => {
    if (!pdf.data) {
      setPdfPreview(null)
      return
    }
    const url = URL.createObjectURL(pdf.data)
    setPdfPreview({ artifactId: draft?.artifactId ?? '', url })
    return () => URL.revokeObjectURL(url)
  }, [pdf.data, draft?.artifactId])
  const selection = useMutation({
    mutationFn: async (mobiles: string[]) =>
      (
        await apiClient.post<NotificationDraft>(
          `/notifications/${draft?.id}/selection`,
          { previewVersion: draft?.previewVersion, selectedMobiles: mobiles },
        )
      ).data,
    onSuccess: setDraft,
    onError: (error) => {
      setProblem(error.message)
      if ('status' in error && error.status === 409)
        setDraft((value) => (value ? { ...value, state: 'stale' } : value))
    },
  })
  const send = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<NotificationDraft>(
          `/notifications/${draft?.id}/send`,
          {
            previewVersion: draft?.previewVersion,
            selectedMobiles: draft?.recipients
              .filter((r) => r.selected)
              .map((r) => r.normalizedMobile),
          },
        )
      ).data,
    onSuccess: (value) => {
      setDraft(value)
      void client.invalidateQueries({ queryKey: ['notifications', invoiceId] })
      toast.success(
        'Notification queued. Delivery status is shown in notification history.',
      )
    },
    onError: (error) => {
      setProblem(error.message)
      if ('status' in error && error.status === 409)
        setDraft((value) => (value ? { ...value, state: 'stale' } : value))
    },
  })
  const close = () => {
    if (send.isPending || selection.isPending) return
    if (draft?.state === 'draft') {
      void apiClient.post(`/notifications/${draft.id}/cancel`).catch(() => {})
    }
    onClose()
  }
  const selectedCount = draft?.recipients.filter((r) => r.selected).length ?? 0
  const ready =
    draft && (!draft.artifactId || pdfUrl) && draft.state === 'draft'
  const title =
    kind === 'invoice_updated'
      ? 'Invoice saved. Send the updated invoice?'
      : kind === 'invoice_ready'
        ? 'Ready for pickup — notify customers'
        : kind === 'invoice_created'
          ? 'Invoice saved — preview WhatsApp notification'
          : 'Resend invoice via WhatsApp'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Review the recipients, message, and any attachment before sending.
          </DialogDescription>
        </DialogHeader>
        {preparing && (
          <p role="status">Preparing the preview… Your invoice is saved.</p>
        )}
        {prepareError && (
          <p role="alert" className="text-destructive">
            The invoice is saved, but the preview could not be prepared:{' '}
            {prepareError.message}
          </p>
        )}
        {draft && (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              INV-{draft.snapshot.invoiceNumber} · {selectedCount} unique mobile
              {selectedCount === 1 ? '' : 's'} selected
            </p>
            <fieldset
              className="space-y-2 rounded-lg border p-3"
              disabled={
                selection.isPending || send.isPending || draft.state !== 'draft'
              }
            >
              <legend className="px-1 text-sm font-semibold">Recipients</legend>
              {draft.recipients.map((recipient) => (
                <label
                  key={recipient.normalizedMobile}
                  className="flex items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={recipient.selected}
                    onChange={(event) => {
                      const mobiles = draft.recipients
                        .filter((r) =>
                          r.normalizedMobile === recipient.normalizedMobile
                            ? event.target.checked
                            : r.selected,
                        )
                        .map((r) => r.normalizedMobile)
                      selection.mutate(mobiles)
                    }}
                  />
                  <span>
                    {recipient.customers.map((c) => c.name).join(', ')} —{' '}
                    <span dir="ltr">{recipient.normalizedMobile}</span>
                  </span>
                </label>
              ))}
              {draft.recipients.length === 0 && (
                <p>No valid mobile numbers are available for this invoice.</p>
              )}
            </fieldset>
            {draft.snapshot.exclusions.length > 0 && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-semibold">Excluded recipients</p>
                {draft.snapshot.exclusions.map((entry, index) => (
                  <p key={index}>
                    {entry.customers.map((c) => c.name).join(', ')}:{' '}
                    {entry.excludedReason}
                  </p>
                ))}
              </div>
            )}
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Message · {draft.snapshot.language}
              </p>
              <p className="whitespace-pre-wrap text-sm">
                {draft.snapshot.body}
              </p>
            </div>
            {draft.artifactId && (
              <div className="space-y-2">
                {pdf.isLoading && <p>Loading the invoice PDF…</p>}
                {pdf.isError && (
                  <p role="alert" className="text-destructive">
                    Could not load the approved PDF. Refresh the preview to try
                    again.
                  </p>
                )}
                {pdfUrl && (
                  <>
                    <iframe
                      title="Invoice PDF preview"
                      src={pdfUrl}
                      className="h-96 w-full rounded border"
                    />
                    <a
                      href={pdfUrl}
                      download={`INV-${draft.snapshot.invoiceNumber}.pdf`}
                      className="text-sm underline"
                    >
                      Open or download the full PDF
                    </a>
                  </>
                )}
              </div>
            )}
            {!draft.canSend && (
              <p className="text-sm text-muted-foreground">
                WhatsApp delivery is currently disabled or unconfigured. Your
                invoice is saved.
              </p>
            )}
            {draft.state === 'approved' && (
              <p role="status">
                This notification is queued or has already been submitted. Check
                notification history for delivery status.
              </p>
            )}
            {draft.state === 'stale' && (
              <p role="alert">
                This preview is out of date. Refresh before sending.
              </p>
            )}
          </div>
        )}
        {problem && (
          <p
            role="alert"
            className="whitespace-pre-wrap text-sm text-destructive"
          >
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={close}
            disabled={send.isPending || selection.isPending}
          >
            {draft?.state === 'approved' ? 'Close' : 'Not now'}
          </Button>
          {(prepareError ||
            problem ||
            draft?.state === 'stale' ||
            pdf.isError) && (
            <Button
              variant="outline"
              disabled={preparing || send.isPending}
              onClick={() => {
                setProblem('')
                if (draft?.artifactId) void pdf.refetch()
                prepare()
              }}
            >
              Refresh preview
            </Button>
          )}
          <Button
            disabled={
              !ready ||
              !draft.canSend ||
              selectedCount === 0 ||
              preparing ||
              selection.isPending ||
              send.isPending
            }
            onClick={() => send.mutate()}
          >
            {send.isPending
              ? 'Queuing…'
              : kind === 'invoice_updated'
                ? 'Send updated invoice'
                : 'Send via WhatsApp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
