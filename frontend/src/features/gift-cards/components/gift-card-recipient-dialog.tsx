import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { PhoneField, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUpdateGiftCard } from '../hooks/use-update-gift-card'
import { recipientPhoneSchema } from '../lib/gift-card-schema'
import type { GiftCard } from '../types/gift-card'

export function GiftCardRecipientDialog({
  card,
  onClose,
}: {
  card: GiftCard
  onClose: () => void
}) {
  const update = useUpdateGiftCard()
  const form = useForm({
    defaultValues: {
      boughtFor: card.boughtFor ?? '',
      recipientPhone: card.recipientPhone ?? '',
    },
    validators: {
      onSubmit: z.object({
        boughtFor: z.string(),
        recipientPhone: recipientPhoneSchema,
      }),
    },
    onSubmit: async ({ value }) => {
      const pending = update.mutateAsync({ id: card.id, ...value })
      toast.promise(pending, {
        loading: 'Saving recipient…',
        success: 'Gift card recipient saved.',
        error: 'Could not save the recipient. Please try again.',
      })
      try {
        await pending
      } catch {
        return
      }
      onClose()
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gift card recipient</DialogTitle>
          <DialogDescription>
            Add or correct the recipient for {card.code}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void form.handleSubmit()
          }}
          className="space-y-4"
        >
          <TextField
            form={form}
            name="boughtFor"
            label="Bought for (optional)"
          />
          <PhoneField
            form={form}
            name="recipientPhone"
            label="Recipient phone"
            defaultCountry="BH"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              Save recipient
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
