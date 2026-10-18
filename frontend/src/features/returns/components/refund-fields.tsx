import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AnyFormApi } from '@/components/form/fields'
import type { ReturnContext } from '../types/returns'
import { refundAllocation } from '../lib/refund-plan'
import { money } from '../lib/display'

const methods = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

export function RefundFields({
  form,
  context,
  due,
}: {
  form: AnyFormApi
  context: ReturnContext
  due: number
}) {
  if (due <= 0)
    return (
      <p className="text-sm text-muted-foreground">
        No money is due back to the customer.
      </p>
    )
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold">Refund due: {money(due)}</p>
      {context.settlement.refundDue > 0 && (
        <p className="text-xs text-muted-foreground">
          Includes existing customer credit:{' '}
          {money(context.settlement.refundDue)}.
        </p>
      )}
      <form.Field name="refundTiming">
        {(field: any) => (
          <Field>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-2 font-medium">Refund timing</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refund-timing"
                  checked={field.state.value === 'now'}
                  onChange={() => field.handleChange('now')}
                />
                Refund now
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refund-timing"
                  checked={field.state.value === 'later'}
                  onChange={() => field.handleChange('later')}
                />
                Refund later
              </label>
            </fieldset>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state: any) => [
          state.values.refundTiming,
          state.values.refundMethod,
          state.values.refundToGiftCard,
        ]}
      >
        {([timing, method, giftFirst]: ['now' | 'later', string, boolean]) => {
          if (timing === 'later')
            return (
              <p className="text-sm text-muted-foreground">
                The credit is recorded now. The amount owed stays visible as a
                pending refund.
              </p>
            )
          const allocation = refundAllocation(context, due, giftFirst)
          return (
            <>
              {context.giftCards.some((card) => card.refundableAmount > 0) &&
                context.settlement.netAmountPaid > 0 && (
                  <form.Field name="refundToGiftCard">
                    {(field: any) => (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.checked)
                          }
                        />
                        Refund to original gift cards first
                      </label>
                    )}
                  </form.Field>
                )}
              {allocation.cash > 0 && (
                <form.Field name="refundMethod">
                  {(field: any) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor="combined-refund-method">
                        Refund method for {money(allocation.cash)}
                      </FieldLabel>
                      <Select
                        items={methods}
                        value={field.state.value}
                        onValueChange={(value: string | null) =>
                          field.handleChange(value ?? '')
                        }
                      >
                        <SelectTrigger
                          id="combined-refund-method"
                          className="w-full"
                        >
                          <SelectValue placeholder="Select refund method..." />
                        </SelectTrigger>
                        <SelectContent>
                          {methods.map((option) => (
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
              )}
              {allocation.gifts.map((gift) => (
                <p key={gift.id} className="text-sm">
                  Restore {money(gift.amount)} to gift card {gift.code}.
                </p>
              ))}
              {allocation.cash > 0 && (
                <p className="text-xs text-muted-foreground">
                  Pay {money(allocation.cash)} back
                  {method
                    ? ` via ${methods.find((entry) => entry.value === method)?.label}`
                    : ''}{' '}
                  before confirming. This records that payout.
                </p>
              )}
              {allocation.uncovered > 0 && (
                <p role="alert" className="text-sm text-destructive">
                  Refresh the invoice to check the available refund methods.
                </p>
              )}
            </>
          )
        }}
      </form.Subscribe>
    </div>
  )
}
