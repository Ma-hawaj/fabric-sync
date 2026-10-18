import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CURRENCY } from '@/lib/currency'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field'
import { NumberField, TextField } from '@/components/form/fields'
import { useCancelOrder } from '../hooks/use-returns'
import {
  cancellationSchema,
  cancellationValue,
  createCancellationForm,
} from '../lib/cancellation-schema'
import { adjustmentSummary, buildRefundPlan } from '../lib/refund-plan'
import { failureMessage, money } from '../lib/display'
import type { CancellationContext } from '../types/returns'
import { RefundFields } from './refund-fields'

export function CancelOrderDialog({
  context: liveContext,
  onClose,
}: {
  context: CancellationContext
  onClose: () => void
}) {
  const [context] = useState(liveContext)
  const mutation = useCancelOrder(context.order.orderId)
  const limit = cancellationValue(context)
  const form = useForm({
    defaultValues: createCancellationForm(),
    validators: { onSubmit: cancellationSchema(context) },
    onSubmit: async ({ value }) => {
      if (value.retainedCharge === '' || value.restoredMaterialQuantity === '')
        return
      const due = adjustmentSummary(
        context.invoice,
        limit - value.retainedCharge,
      ).refundDue
      const pending = mutation.mutateAsync({
        reason: value.reason.trim(),
        retainedCharge: value.retainedCharge,
        restoredMaterialQuantity: value.restoredMaterialQuantity,
        workChargeConfirmed: value.workChargeConfirmed,
        unusedMaterialConfirmed: value.unusedMaterialConfirmed,
        refund: buildRefundPlan(context.invoice, due, value),
      })
      toast.promise(pending, {
        loading: 'Cancelling order...',
        success:
          value.refundTiming === 'later' && due > 0
            ? 'Order cancelled. The refund is pending.'
            : 'Order cancelled and any refund recorded.',
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancel Order & Refund</DialogTitle>
          <DialogDescription>
            Close this uncollected garment while preserving its invoice and
            production history.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={mutation.isPending} className="space-y-4">
            <p className="text-sm">
              Discounted order value: <strong>{money(limit)}</strong>
            </p>
            <TextField
              form={form}
              name="reason"
              label="Reason for cancellation"
            />
            {context.order.productionStarted ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Production has started. Record the work/material charge agreed
                  with the customer.
                </p>
                <NumberField
                  form={form}
                  name="retainedCharge"
                  label={`Retained work/material charge (${CURRENCY})`}
                />
                <form.Field name="workChargeConfirmed">
                  {(field) => (
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.checked)
                          }
                        />
                        The retained charge was agreed with the customer
                      </label>
                      <FieldError errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Production has not started. The order receives full credit.
              </p>
            )}
            {context.order.canRestoreMaterial ? (
              <>
                <form.Field name="unusedMaterialConfirmed">
                  {(field) => (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.checked)
                        }
                      />
                      Restore confirmed unused fabric to{' '}
                      {context.order.stockLocation}
                    </label>
                  )}
                </form.Field>
                <NumberField
                  form={form}
                  name="restoredMaterialQuantity"
                  label={`Unused fabric to restore (up to ${context.order.materialAmount} m)`}
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {context.order.materialSource === 'customer'
                  ? 'Customer-provided fabric is not added to shop inventory.'
                  : 'The original stock location is unavailable. Any verified unused fabric must be handled through Inventory.'}
              </p>
            )}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                const credit = Math.max(
                  0,
                  limit - Number(values.retainedCharge),
                )
                const summary = adjustmentSummary(context.invoice, credit)
                return (
                  <>
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold">
                        Cancellation credit: {money(credit)}
                      </p>
                      {summary.appliedToBalance > 0 && (
                        <p>
                          Applied to unpaid balance:{' '}
                          {money(summary.appliedToBalance)}
                        </p>
                      )}
                    </div>
                    <RefundFields
                      form={form}
                      context={context.invoice}
                      due={summary.refundDue}
                    />
                  </>
                )
              }}
            </form.Subscribe>
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
                Back
              </Button>
              <form.Subscribe selector={(state) => state.values}>
                {(values) => {
                  const due = adjustmentSummary(
                    context.invoice,
                    Math.max(0, limit - Number(values.retainedCharge)),
                  ).refundDue
                  return (
                    <Button type="submit" disabled={mutation.isPending}>
                      {due > 0 && values.refundTiming === 'now'
                        ? 'Confirm Cancellation & Refund'
                        : 'Confirm Cancellation'}
                    </Button>
                  )
                }}
              </form.Subscribe>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
