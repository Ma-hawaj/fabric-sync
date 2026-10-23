import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGiftCardPreview } from '../hooks/use-gift-card-preview'
import { useSendGiftCard } from '../hooks/use-send-gift-card'
import type { GiftCard } from '../types/gift-card'

export function SendGiftCardDialog({
  card,
  onClose,
}: {
  card: GiftCard
  onClose: () => void
}) {
  const preview = useGiftCardPreview(card.id)
  const send = useSendGiftCard()
  const [requestId] = useState(() => crypto.randomUUID())
  const [problem, setProblem] = useState('')
  async function submit() {
    if (!preview.data?.canSend) return
    setProblem('')
    try {
      const result = await send.mutateAsync({
        id: card.id,
        sourceHash: preview.data.sourceHash,
        requestId,
      })
      toast.success(
        result.state === 'queued'
          ? 'Gift card queued for WhatsApp delivery.'
          : `Gift card delivery: ${result.state}.`,
      )
      onClose()
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : 'Could not send the gift card. Please try again.',
      )
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !send.isPending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send gift card via WhatsApp</DialogTitle>
          <DialogDescription>
            Check the recipient and message for {card.code}.
          </DialogDescription>
        </DialogHeader>
        {preview.isPending && <p>Loading preview…</p>}
        {preview.error && <p role="alert">{preview.error.message}</p>}
        {preview.data && (
          <>
            <p>
              <strong>To:</strong>{' '}
              {preview.data.boughtFor ? `${preview.data.boughtFor} · ` : ''}
              {preview.data.mobile}
            </p>
            <p className="whitespace-pre-wrap rounded-md border p-3">
              {preview.data.body}
            </p>
            {!preview.data.canSend && (
              <p role="alert">{preview.data.unavailableReason}</p>
            )}
          </>
        )}
        {problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!preview.data?.canSend || send.isPending}
          >
            {send.isPending ? 'Sending…' : 'Send via WhatsApp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
