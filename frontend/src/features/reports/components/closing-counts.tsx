import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { NumberField, TextareaField } from '@/components/form/fields'
import { Field, FieldError } from '@/components/ui/field'
import { compareCounts, countsSchema, emptyCounts } from '../lib/closing-counts'
import { CountsComparison } from './closing-comparison'
import { formatBhd } from '../lib/sales-closing'
import { useCloseDay } from '../hooks/use-sales-closing'
import type { ClosingCounts, SalesClosing } from '../types/sales-closing'

export function ClosingCountsForm({
  report,
  queryDate,
  disabled,
}: {
  report: SalesClosing
  queryDate: string
  disabled: boolean
}) {
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useCloseDay(queryDate, report.branchId)
  const form = useForm({
    defaultValues: {
      ...emptyCounts(),
      openingCash: report.opening?.amount ?? '',
    },
    validators: { onSubmit: countsSchema(report) },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        requestId,
        branchId: report.branchId,
        date: report.date,
        fingerprint: report.fingerprint,
        counts: value as ClosingCounts,
      })
      toast.promise(pending, {
        loading: 'Closing branch day...',
        success: 'Branch day closed. The saved report is read-only.',
        error: (error) =>
          error instanceof ApiError
            ? error.message
            : 'Could not confirm closing. Refresh before retrying.',
      })
      try {
        await pending
      } catch {
        return
      }
    },
  })
  // Preserve counted money and notes across refreshes, but require a new review.
  useEffect(() => {
    form.setFieldValue('openingCash', report.opening?.amount ?? '')
    form.setFieldValue('branchActivityConfirmed', false)
  }, [form, report.fingerprint, report.opening?.amount])
  const amountField = (
    name:
      | 'cashAdded'
      | 'cashRemoved'
      | 'actualCash'
      | 'actualBenefit'
      | 'actualCard',
    label: string,
    signed = false,
  ) => (
    <NumberField
      form={form}
      name={name}
      label={label}
      min={signed ? undefined : 0}
      step={0.001}
      format={{ maximumFractionDigits: 3 }}
    />
  )
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">3. Count and close</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Count the cash drawer and enter the confirmed net Benefit and Card
          totals after refunds. Enter zero explicitly when there is none.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <fieldset
          disabled={disabled || mutation.isPending}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm font-medium">Saved opening cash (BHD)</p>
              <p className="mt-2 font-mono">
                {formatBhd(report.opening?.amount ?? 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Recorded separately at opening.
              </p>
            </div>
            {amountField('cashAdded', 'Other cash added (BHD)')}
            {amountField('cashRemoved', 'Cash banked / transferred out (BHD)')}
          </div>
          <p className="text-xs text-muted-foreground">
            Do not enter expenses or customer refunds again as cash removed.
            Expected cash = saved opening + recorded net cash − recorded cash
            expenses + other cash added − cash banked/transferred out. Explain
            other cash movements below.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {amountField('actualCash', 'Cash physically counted (BHD)')}
            {amountField('actualBenefit', 'Confirmed net Benefit (BHD)', true)}
            {amountField('actualCard', 'Confirmed net Card (BHD)', true)}
          </div>
          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              const complete = [
                values.openingCash,
                values.cashAdded,
                values.cashRemoved,
                values.actualCash,
                values.actualBenefit,
                values.actualCard,
              ].every(
                (value) => typeof value === 'number' && Number.isFinite(value),
              )
              const comparison = complete
                ? compareCounts(report, values as ClosingCounts)
                : null
              return (
                <div className="overflow-x-auto rounded-lg border">
                  <div className="p-3 text-start font-semibold">
                    Recorded vs actual{' '}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {!comparison
                        ? 'Enter all amounts to check'
                        : comparison.lines.some((line) => line.difference !== 0)
                          ? 'Difference found'
                          : comparison.matched
                            ? 'Amounts match — ready to close'
                            : 'Amounts match — review outstanding items'}
                    </span>
                  </div>
                  <CountsComparison comparison={comparison ?? undefined} />
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Positive = over. Negative = short. Gift cards are tracked
                    separately.
                  </p>
                </div>
              )
            }}
          </form.Subscribe>
          <TextareaField form={form} name="notes" label="Closing notes" />
          <form.Field name="branchActivityConfirmed">
            {(field) => (
              <Field>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(event) =>
                      field.handleChange(event.target.checked)
                    }
                    className="mt-1"
                  />
                  I verified the listed payments and refunds were handled at{' '}
                  {report.branchName}, have finished recording today’s activity,
                  and understand that closing permanently locks this report.
                </label>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Closing saves these counts and notes, locks opening cash and
              expenses, and blocks new orders and payments until the next
              business day.
            </p>
            <Button type="submit">
              {mutation.isPending ? 'Closing…' : 'Review and close day'}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
