import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { TextareaField } from '@/components/form/fields'
import { ApiError } from '@/lib/api'
import { useTillAction } from '../hooks/use-sales-closing'
import { missedClosingSchema } from '../lib/missed-closing-schema'
import type { SalesClosing } from '../types/sales-closing'

function failure(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Could not confirm the save. Refresh before retrying.'
}

export function SkipMissedDay({
  report,
  disabled,
}: {
  report: SalesClosing
  disabled: boolean
}) {
  const date = report.previousUnclosedDate
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useTillAction()
  const form = useForm({
    defaultValues: { reason: '', acknowledged: false },
    validators: { onSubmit: missedClosingSchema },
    onSubmit: async ({ value }) => {
      if (!date) return
      const pending = mutation.mutateAsync({
        path: '/sales-closing/missed',
        body: {
          requestId,
          branchId: report.branchId,
          date,
          reason: value.reason,
        },
      })
      toast.promise(pending, {
        loading: 'Skipping missed day...',
        success: 'Day skipped. Its figures remain unchanged and unreconciled.',
        error: failure,
      })
      try {
        await pending
      } catch {
        return
      }
    },
  })
  if (!date || report.closure || report.missedClosing) return null
  return (
    <section className="space-y-4 rounded-xl border border-destructive/40 p-5">
      <h2 className="text-lg font-semibold">Skip missed day · {date}</h2>
      <p className="text-sm">
        {report.lateClosingDate === date
          ? 'This day can still be closed before the next opening. Skip only if its closing counts cannot be recovered.'
          : 'This past report is read-only. A manager must skip it before new orders can continue.'}{' '}
        Skipping preserves the figures and leaves the day unreconciled.
      </p>
      <a
        className="text-sm underline"
        href={`/sales-closing?branchId=${report.branchId}&date=${date}`}
      >
        View the missed day
      </a>
      <PermissionGuard method="POST" path="/sales-closing/missed">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset
            disabled={disabled || mutation.isPending}
            className="space-y-4"
          >
            <TextareaField
              form={form}
              name="reason"
              label="Reason for skipping this day"
            />
            <form.Field name="acknowledged">
              {(field) => (
                <Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.checked)
                      }
                    />
                    I understand that this does not reconcile the old day or
                    change its figures. The skipped report will be read-only.
                  </label>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <Button type="submit">
              {mutation.isPending ? 'Saving…' : 'Skip missed day'}
            </Button>
          </fieldset>
        </form>
      </PermissionGuard>
    </section>
  )
}
