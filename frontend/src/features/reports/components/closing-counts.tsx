import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError } from '@/components/ui/field'
import { compareCounts, countsSchema, emptyCounts } from '../lib/closing-counts'
import { formatBhd, methodLabel } from '../lib/sales-closing'
import { useSaveClosing } from '../hooks/use-sales-closing'
import type { ClosingCounts, SalesClosing } from '../types/sales-closing'

export function ClosingCountsForm({
  report,
  queryDate,
  disabled,
  onDirty,
}: {
  report: SalesClosing
  queryDate: string
  disabled: boolean
  onDirty: (dirty: boolean) => void
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const mutation = useSaveClosing(queryDate, report.branchId)
  const saved = report.lastCheck
  const stale = Boolean(saved && saved.fingerprint !== report.fingerprint)
  const form = useForm({
    defaultValues: saved
      ? {
          ...saved.counts,
          openingCash: report.opening?.amount ?? '',
          branchActivityConfirmed:
            !stale && saved.counts.branchActivityConfirmed,
        }
      : { ...emptyCounts(), openingCash: report.opening?.amount ?? '' },
    validators: { onSubmit: countsSchema(report) },
    listeners: { onChange: () => onDirty(true) },
    onSubmit: async ({ value }) => {
      const counts = value as ClosingCounts
      const pending = mutation.mutateAsync({
        requestId,
        branchId: report.branchId,
        date: report.date,
        fingerprint: report.fingerprint,
        counts,
      })
      toast.promise(pending, {
        loading: 'Saving the branch check...',
        success: (check) =>
          check.comparison.matched
            ? 'Branch totals match. Check saved.'
            : 'Check saved with differences or items to review.',
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'This check may already be saved, or transactions changed. Refresh before checking again.'
            : error instanceof ApiError && error.status === 400
              ? error.message
              : 'Could not confirm the save. Refresh the report, then retry the original values if needed.',
      })
      try {
        await pending
      } catch {
        return
      }
      setRequestId(crypto.randomUUID())
      onDirty(false)
    },
  })
  const amountField = (
    name:
      | 'openingCash'
      | 'cashAdded'
      | 'cashRemoved'
      | 'actualCash'
      | 'actualBenefit'
      | 'actualCard',
    label: string,
    signed = false,
  ) => (
    <form.Field name={name}>
      {(field) => (
        <Field>
          <label htmlFor={field.name} className="text-sm font-medium">
            {label}
          </label>
          <Input
            id={field.name}
            type="number"
            inputMode="decimal"
            min={signed ? undefined : 0}
            step="0.001"
            placeholder="0.000"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) =>
              field.handleChange(
                event.target.value === '' ? '' : Number(event.target.value),
              )
            }
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">3. Closing count</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Count the cash drawer and enter the confirmed net Benefit and Card
          totals after refunds. Enter zero explicitly when there is none.
        </p>
      </div>
      {saved && (
        <p
          role="status"
          className={
            stale ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {stale
            ? 'Transactions changed since the last saved check. Review and save a new check.'
            : `Last check saved ${new Date(saved.checkedAt).toLocaleString('en-GB', { timeZone: report.timezone })}.`}
        </p>
      )}
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
                  <table className="w-full text-sm">
                    <caption className="p-3 text-start font-semibold">
                      Recorded vs actual{' '}
                      <span className="ms-2 text-xs font-normal text-muted-foreground">
                        {!comparison
                          ? 'Enter all amounts to check'
                          : comparison.lines.some(
                                (line) => line.difference !== 0,
                              )
                            ? 'Difference found'
                            : comparison.matched
                              ? 'Amounts match — save to record the check'
                              : 'Amounts match — review outstanding items'}
                      </span>
                    </caption>
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-3 text-start">Method</th>
                        <th className="p-3 text-end">Expected (BHD)</th>
                        <th className="p-3 text-end">Actual (BHD)</th>
                        <th className="p-3 text-end">Over / short (BHD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {['cash', 'benefit', 'card'].map((method) => {
                        const line = comparison?.lines.find(
                          (item) => item.method === method,
                        )
                        return (
                          <tr key={method} className="border-b last:border-0">
                            <th className="p-3 text-start font-medium">
                              {methodLabel(method)}
                            </th>
                            <td className="p-3 text-end font-mono">
                              {line ? formatBhd(line.expected) : '—'}
                            </td>
                            <td className="p-3 text-end font-mono">
                              {line ? formatBhd(line.actual) : '—'}
                            </td>
                            <td
                              className={`p-3 text-end font-mono ${line?.difference ? 'text-destructive' : ''}`}
                            >
                              {line
                                ? `${line.difference > 0 ? '+' : ''}${formatBhd(line.difference)}`
                                : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Positive = over. Negative = short. Gift cards are tracked
                    separately.
                  </p>
                </div>
              )
            }}
          </form.Subscribe>
          <form.Field name="notes">
            {(field) => (
              <Field>
                <label htmlFor="closing-notes" className="text-sm font-medium">
                  Closing notes
                </label>
                <Textarea
                  id="closing-notes"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Explain any difference, cash added or cash removed."
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
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
                  {report.branchName}.
                </label>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              A saved check keeps these figures and notes. New transactions
              require a fresh check.
            </p>
            <Button type="submit">
              {mutation.isPending ? 'Saving…' : 'Save branch check'}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
