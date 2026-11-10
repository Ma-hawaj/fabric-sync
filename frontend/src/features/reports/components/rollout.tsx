import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError } from '@/components/ui/field'
import { TextareaField } from '@/components/form/fields'
import { ApiError } from '@/lib/api'
import { useTillAction } from '../hooks/use-sales-closing'
import {
  missedClosingSchema,
  nextBusinessDate,
  rolloutSchema,
} from '../lib/rollout-schema'
import type { SalesClosing } from '../types/sales-closing'

function failure(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Could not confirm the save. Refresh before retrying.'
}

export function RolloutSetup({
  report,
  disabled,
}: {
  report: SalesClosing
  disabled: boolean
}) {
  const today = report.businessDate || report.date
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useTillAction()
  const form = useForm({
    defaultValues: { startsOn: nextBusinessDate(today) },
    validators: { onSubmit: rolloutSchema(today) },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        path: '/sales-closing/setup',
        body: {
          requestId,
          branchId: report.branchId,
          startsOn: value.startsOn,
        },
      })
      toast.promise(pending, {
        loading: 'Saving go-live date...',
        success: 'Go-live date saved. Earlier history remains read-only.',
        error: failure,
      })
      try {
        await pending
      } catch {
        return
      }
    },
  })
  if (!report.policy && (report.closure || report.missedClosing)) return null
  if (report.policy)
    return (
      <p className="text-xs text-muted-foreground">
        Closing controls start {report.policy.startsOn}. The go-live date is
        fixed; earlier history remains read-only.
      </p>
    )
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">First rollout</h2>
      <p className="text-sm text-muted-foreground">
        A manager must set this branch’s go-live date before trading. Earlier
        history stays read-only and will not block new orders. Choose the next
        business day if trading has already started today. The go-live date
        cannot be changed after saving.
      </p>
      <PermissionGuard method="POST" path="/sales-closing/setup">
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
            <form.Field name="startsOn">
              {(field) => (
                <Field>
                  <label
                    htmlFor="closing-start-date"
                    className="text-sm font-medium"
                  >
                    Go-live date
                  </label>
                  <Input
                    id="closing-start-date"
                    type="date"
                    min={today}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <Button type="submit">
              {mutation.isPending ? 'Saving…' : 'Set go-live date'}
            </Button>
          </fieldset>
        </form>
      </PermissionGuard>
    </section>
  )
}

export function MissedClosingResolution({
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
        loading: 'Recording missed closing...',
        success:
          'Missed closing resolved. Its figures remain unchanged and unreconciled.',
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
      <h2 className="text-lg font-semibold">Missed closing · {date}</h2>
      <p className="text-sm">
        This past report is read-only. A manager must record a separate
        resolution before new orders can continue. The resolution preserves the
        figures and leaves the day unreconciled.
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
              label="Manager explanation for the missed closing"
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
                    change its figures. The resolution will be read-only.
                  </label>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <Button type="submit">
              {mutation.isPending ? 'Saving…' : 'Resolve missed closing'}
            </Button>
          </fieldset>
        </form>
      </PermissionGuard>
    </section>
  )
}
