import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumberField, TextField } from '@/components/form/fields'
import { CURRENCY } from '@/lib/currency'
import { money, failureMessage } from '../lib/display'
import { ReturnDialog } from './return-dialog'
import { useCreateRefund, useReturns } from '../hooks/use-returns'
import {
  createRefundForm,
  eligibleLines,
  refundLimit,
  refundSchema,
} from '../lib/return-schema'
import type { CreateRefundInput, ReturnContext } from '../types/returns'

export function ReturnsPanel({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError, refetch } = useReturns(invoiceId)
  const [dialog, setDialog] = useState<'return' | 'refund' | null>(null)

  return (
    <section className="space-y-3" aria-labelledby="returns-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="returns-heading" className="text-sm font-semibold">
          Returns & Refunds
        </h2>
        {data && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={eligibleLines(data.lines).length === 0}
              onClick={() => setDialog('return')}
            >
              Return & Refund
            </Button>
            <Button
              variant="outline"
              disabled={data.settlement.refundDue <= 0}
              onClick={() => setDialog('refund')}
            >
              Refund Pending Credit
            </Button>
          </div>
        )}
      </div>
      {isLoading && (
        <p className="text-sm text-muted-foreground">
          Loading return history...
        </p>
      )}
      {isError && (
        <div className="text-sm text-destructive" role="alert">
          Could not load returns.{' '}
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            Return credits: {money(data.settlement.amountCredited)} · Refunded:{' '}
            {money(
              data.settlement.cashRefunded + data.settlement.giftCardRefunded,
            )}{' '}
            · Refund due: {money(data.settlement.refundDue)}
          </p>
          {data.returns.length === 0 && data.refunds.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No returns or refunds recorded.
            </p>
          )}
          {data.returns.map((entry) => (
            <article key={entry.id} className="rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {entry.kind === 'cancellation' ? 'Cancellation' : 'Return'} ·{' '}
                  {money(entry.amount)}
                </strong>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1">{entry.reason}</p>
              {data.refunds.some(
                (refund) => refund.adjustmentId === entry.id,
              ) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Refunded at confirmation:{' '}
                  {money(
                    data.refunds
                      .filter((refund) => refund.adjustmentId === entry.id)
                      .reduce((sum, refund) => sum + refund.amount, 0),
                  )}
                </p>
              )}
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {entry.lines.map((line, index) => (
                  <li key={index}>
                    {line.description} × {line.quantity} · {money(line.amount)}
                    {line.restocked ? ' · Restocked' : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Recorded by {entry.createdBy} · {entry.id}
              </p>
            </article>
          ))}
          {data.refunds.map((entry) => (
            <article key={entry.id} className="rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  Refund · {money(entry.amount)} ·{' '}
                  {entry.giftCardCode ?? entry.paymentType}
                </strong>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1">{entry.reason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Recorded by {entry.createdBy} · {entry.id}
              </p>
            </article>
          ))}
          {dialog === 'return' && (
            <ReturnDialog
              invoiceId={invoiceId}
              context={data}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog === 'refund' && (
            <RefundDialog
              invoiceId={invoiceId}
              context={data}
              onClose={() => setDialog(null)}
            />
          )}
        </>
      )}
    </section>
  )
}

function RefundDialog({
  invoiceId,
  context: liveContext,
  onClose,
}: {
  invoiceId: string
  context: ReturnContext
  onClose: () => void
}) {
  const [context] = useState(liveContext)
  const mutation = useCreateRefund(invoiceId)
  const options = [
    ...(['cash', 'benefit', 'card'] as const)
      .filter(() => context.settlement.netAmountPaid > 0)
      .map((value) => ({
        value,
        label:
          value === 'benefit' ? 'Benefit' : value === 'cash' ? 'Cash' : 'Card',
      })),
    ...context.giftCards
      .filter((card) => card.refundableAmount > 0)
      .map((card) => ({
        value: `gift_card:${card.id}`,
        label: `Gift card ${card.code}`,
      })),
  ]
  const form = useForm({
    defaultValues: createRefundForm(),
    validators: { onSubmit: refundSchema(context) },
    onSubmit: async ({ value }) => {
      if (value.amount === '') return
      const gift = value.destination.startsWith('gift_card:')
      const pending = mutation.mutateAsync({
        reason: value.reason.trim(),
        amount: value.amount,
        paymentType: gift
          ? 'gift_card'
          : (value.destination as CreateRefundInput['paymentType']),
        giftCardId: gift ? value.destination.slice(10) : null,
      })
      toast.promise(pending, {
        loading: 'Recording refund...',
        success: 'Refund recorded.',
        error: failureMessage,
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
      onOpenChange={(open) => !open && !mutation.isPending && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Refund</DialogTitle>
          <DialogDescription>
            Customer credit available: {money(context.settlement.refundDue)}.
            Cash, Benefit and card refunds record money you have paid back. A
            gift card refund restores its balance immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <form.Field name="destination">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="refund-destination">
                  Refund method
                </FieldLabel>
                <Select
                  items={options}
                  value={field.state.value}
                  disabled={mutation.isPending}
                  onValueChange={(value: string | null) =>
                    field.handleChange(value ?? '')
                  }
                >
                  <SelectTrigger id="refund-destination" className="w-full">
                    <SelectValue placeholder="Select refund method..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.destination}>
            {(destination) => (
              <p className="text-sm text-muted-foreground">
                Maximum for this method:{' '}
                {money(refundLimit(context, destination))}
              </p>
            )}
          </form.Subscribe>
          <NumberField
            form={form}
            name="amount"
            label={`Refund amount (${CURRENCY})`}
          />
          <TextField form={form} name="reason" label="Reason for refund" />
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {failureMessage(mutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              Confirm Refund
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
