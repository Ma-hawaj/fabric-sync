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
import { AsyncCombobox } from '@/components/form/async-combobox'
import { STOCK_FILTERS } from '@/features/locations/lib/location-filters'
import type { Location } from '@/features/locations/types/location'
import { NumberField, TextField } from '@/components/form/fields'
import { useCreateReturn } from '../hooks/use-returns'
import {
  createReturnForm,
  eligibleLines,
  remainingQuantity,
  returnCredit,
  returnSchema,
} from '../lib/return-schema'
import { adjustmentSummary, buildRefundPlan } from '../lib/refund-plan'
import { money, failureMessage } from '../lib/display'
import type { ReturnContext } from '../types/returns'
import { RefundFields } from './refund-fields'

export function ReturnDialog({
  invoiceId,
  context: liveContext,
  orderId,
  onClose,
}: {
  invoiceId: string
  context: ReturnContext
  orderId?: string
  onClose: () => void
}) {
  const [context] = useState(liveContext)
  const mutation = useCreateReturn(invoiceId)
  const [lines] = useState(() =>
    eligibleLines(context.lines).filter(
      (line) => !orderId || line.lineId === orderId,
    ),
  )
  const form = useForm({
    defaultValues: createReturnForm(context.lines, orderId),
    validators: { onSubmit: returnSchema(context) },
    onSubmit: async ({ value }) => {
      const selected = value.lines.flatMap((line) =>
        line.quantity !== '' && line.quantity > 0
          ? [
              {
                ...line,
                quantity: line.quantity,
                restockLocationId: line.restock ? line.restockLocationId : null,
              },
            ]
          : [],
      )
      const due = adjustmentSummary(
        context,
        returnCredit(context.lines, value.lines),
      ).refundDue
      const pending = mutation.mutateAsync({
        reason: value.reason.trim(),
        lines: selected,
        refund: buildRefundPlan(context, due, value),
      })
      toast.promise(pending, {
        loading: 'Recording return and refund...',
        success:
          value.refundTiming === 'later' && due > 0
            ? 'Return recorded. The refund is pending.'
            : 'Return and any refund recorded.',
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
          <DialogTitle>
            {orderId ? 'Return Order & Refund' : 'Return & Refund'}
          </DialogTitle>
          <DialogDescription>
            Return eligible merchandise at its discounted sale value. Collected
            tailoring garments are returned as whole items. Gift card sales are
            excluded.
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
            <div className="max-h-64 space-y-3 overflow-y-auto">
              {lines.map((line, index) => (
                <div
                  key={line.lineId}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <p className="text-sm font-medium">{line.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Purchased: {line.quantity} · Already returned:{' '}
                    {line.returnedQuantity} · Available:{' '}
                    {remainingQuantity(line)}{' '}
                    {line.kind === 'order' ? 'garment' : 'units'} · Remaining
                    credit: {money(line.creditLimit - line.creditedAmount)}
                  </p>
                  {orderId ? (
                    <p className="text-sm">Returning one whole garment.</p>
                  ) : (
                    <NumberField
                      form={form}
                      name={`lines[${index}].quantity`}
                      label={`Quantity to return — ${line.description}`}
                      min={0}
                      max={remainingQuantity(line)}
                      step={line.kind === 'order' ? 1 : 'any'}
                      format={{
                        maximumFractionDigits: line.kind === 'order' ? 0 : 2,
                      }}
                      showControls
                    />
                  )}
                  {line.canRestock && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Originally sold from:{' '}
                        {line.originalLocationName ?? 'Location not recorded'}
                      </p>
                      <form.Field name={`lines[${index}].restock`}>
                        {(field) => (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              aria-label={`Restock ${line.description}`}
                              checked={field.state.value}
                              onChange={(event) =>
                                field.handleChange(event.target.checked)
                              }
                            />
                            Restock returned item
                          </label>
                        )}
                      </form.Field>
                      <form.Subscribe
                        selector={(state) => state.values.lines[index].restock}
                      >
                        {(restock) =>
                          restock && (
                            <form.Field
                              name={`lines[${index}].restockLocationId`}
                            >
                              {(field) => (
                                <Field
                                  data-invalid={
                                    field.state.meta.errors.length > 0
                                  }
                                >
                                  <FieldLabel htmlFor={field.name}>
                                    Restock location — {line.description}
                                  </FieldLabel>
                                  <AsyncCombobox<Location>
                                    id={field.name}
                                    endpoint="/locations"
                                    queryKey="return-restock-locations"
                                    searchField="name"
                                    filters={STOCK_FILTERS}
                                    toOption={(location) => ({
                                      value: location.id,
                                      label: location.name,
                                    })}
                                    getValueLabel={(id) =>
                                      id === line.originalLocationId
                                        ? line.originalLocationName
                                        : null
                                    }
                                    value={field.state.value || null}
                                    onValueChange={(id) =>
                                      field.handleChange(id ?? '')
                                    }
                                    placeholder="Select a stock location..."
                                    emptyMessage="No active stock locations found."
                                    disabled={mutation.isPending}
                                  />
                                  <FieldError
                                    errors={field.state.meta.errors}
                                  />
                                </Field>
                              )}
                            </form.Field>
                          )
                        }
                      </form.Subscribe>
                    </>
                  )}
                </div>
              ))}
            </div>
            <form.Field name="lines">
              {(field) => <FieldError errors={field.state.meta.errors} />}
            </form.Field>
            <TextField form={form} name="reason" label="Reason for return" />
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                const credit = returnCredit(context.lines, values.lines)
                const summary = adjustmentSummary(context, credit)
                return (
                  <>
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold">
                        Return credit: {money(credit)}
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
                      context={context}
                      due={summary.refundDue}
                    />
                  </>
                )
              }}
            </form.Subscribe>
            {orderId && (
              <p className="text-xs text-muted-foreground">
                The order will be closed as Returned. Fabric stock and the
                original production history are preserved.
              </p>
            )}
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
                    context,
                    returnCredit(context.lines, values.lines),
                  ).refundDue
                  return (
                    <Button type="submit" disabled={mutation.isPending}>
                      {due > 0 && values.refundTiming === 'now'
                        ? 'Confirm Return & Refund'
                        : 'Confirm Return'}
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
