import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { DateField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CURRENCY } from '@/lib/currency'
import { useReplaceGiftCard } from '../hooks/use-replace-gift-card'
import type { GiftCard } from '../types/gift-card'
import { giftCardReplacementSchema } from '../lib/gift-card-schema'

/** Replace a lost code without issuing additional value or creating another invoice. */
export function ReplaceGiftCardDialog({
  card,
  onClose,
}: {
  card: GiftCard
  onClose: () => void
}) {
  const replace = useReplaceGiftCard()
  const [problem, setProblem] = useState('')
  const replacement = replace.data
  const today = new Date().toISOString().slice(0, 10)
  const form = useForm({
    defaultValues: { expiresOn: card.expiresOn ?? '' },
    validators: card.taxedAtIssue
      ? undefined
      : { onSubmit: giftCardReplacementSchema(today) },
    onSubmit: async ({ value }) => {
      try {
        await replace.mutateAsync({
          id: card.id,
          expiresOn: value.expiresOn || null,
        })
      } catch (error) {
        setProblem(
          error instanceof Error
            ? error.message
            : 'Could not replace this card. Please try again.',
        )
      }
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !replace.isPending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {replacement ? 'Replacement card issued' : 'Replace gift card'}
          </DialogTitle>
          <DialogDescription>
            {replacement
              ? 'The balance has been transferred. The old code can no longer be used.'
              : 'Create a new code for the remaining balance. The old code will stop working.'}
          </DialogDescription>
        </DialogHeader>
        {replacement && (
          <p
            className="rounded-lg bg-muted p-4 font-mono text-lg font-semibold"
            aria-label="New gift card code"
          >
            {replacement.code}
          </p>
        )}
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {replacement ? 'Replaces' : 'Original card'}
            </dt>
            <dd className="font-mono">{card.code}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {replacement ? 'Transferred balance' : 'Remaining balance'}
            </dt>
            <dd className="font-semibold">
              {CURRENCY} {(replacement?.balance ?? card.balance).toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Recipient</dt>
            <dd>
              {card.boughtFor ?? 'Not named'}
              {card.recipientPhone && ` · ${card.recipientPhone}`}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{(replacement ?? card).expiresOn ?? 'Never'}</dd>
          </div>
        </dl>
        {!card.taxedAtIssue && !replacement && (
          <div className="space-y-2">
            <DateField
              form={form}
              name="expiresOn"
              label="New expiry date (optional)"
            />
            <p className="text-xs text-muted-foreground">
              Choose today or a future date. Leave blank for no expiry.
            </p>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {card.taxedAtIssue
            ? 'Recipient details, expiry, and the original VAT treatment carry over.'
            : 'Recipient details and the original VAT treatment carry over.'}{' '}
          No new invoice is created.
        </p>
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
        <DialogFooter>
          {replacement ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={replace.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setProblem('')
                  void form.handleSubmit()
                }}
                disabled={replace.isPending}
              >
                {replace.isPending ? 'Replacing…' : 'Replace card'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
