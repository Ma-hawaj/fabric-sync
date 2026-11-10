import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { PermissionGuard } from '@/components/permission-guard'
import { NumberField, TextField, TextareaField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { Field, FieldError } from '@/components/ui/field'
import { useTillAction } from '../hooks/use-sales-closing'
import {
  expenseSchema,
  openingCorrectionSchema,
  openingSchema,
  voidExpenseSchema,
} from '../lib/till-schema'
import { formatBhd, isClosingReadOnly } from '../lib/sales-closing'
import type { BranchExpense, SalesClosing } from '../types/sales-closing'

function failure(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return `${error.message} Refresh the report before retrying changed values.`
  return error instanceof ApiError && error.status === 400
    ? error.message
    : 'Could not confirm the save. Refresh and check the history before retrying.'
}

export function OpeningCashSection({
  report,
  disabled,
}: {
  report: SalesClosing
  disabled: boolean
}) {
  const opening = report.opening
  const readOnly = isClosingReadOnly(report)
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">1. Opening cash</h2>
      {opening ? (
        <>
          <p className="font-mono text-2xl">
            {formatBhd(opening.amount)} <span className="text-xs">BHD</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Saved{' '}
            {new Date(opening.recordedAt).toLocaleString('en-GB', {
              timeZone: report.timezone,
            })}
            . This amount is read-only at closing.
            {opening.supersedesId
              ? ' A correction is recorded in its history.'
              : ''}
          </p>
          {opening.notes && <p className="text-sm">{opening.notes}</p>}
          {!readOnly && (
            <PermissionGuard
              method="POST"
              path="/sales-closing/openings/ID/corrections"
            >
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Correct opening cash (manager)
                </summary>
                <OpeningForm
                  key={opening.id}
                  report={report}
                  disabled={disabled}
                  correcting
                />
              </details>
            </PermissionGuard>
          )}
        </>
      ) : readOnly ? (
        <p className="text-sm">No opening amount recorded.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Count and save the cash in the drawer when this branch starts the
            day. Closing will use this saved amount.
          </p>
          <OpeningForm
            report={report}
            disabled={
              disabled ||
              Boolean(report.previousUnclosedDate) ||
              Boolean(report.businessDate && report.date > report.businessDate)
            }
          />
        </>
      )}
    </section>
  )
}

function OpeningForm({
  report,
  disabled,
  correcting = false,
}: {
  report: SalesClosing
  disabled: boolean
  correcting?: boolean
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const mutation = useTillAction()
  const defaultValues: { openingAmount: number | ''; openingNotes: string } = {
    openingAmount: correcting && report.opening ? report.opening.amount : '',
    openingNotes: '',
  }
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: correcting ? openingCorrectionSchema : openingSchema,
    },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        path:
          correcting && report.opening
            ? `/sales-closing/openings/${report.opening.id}/corrections`
            : '/sales-closing/openings',
        body: {
          requestId,
          branchId: report.branchId,
          date: report.date,
          amount: value.openingAmount,
          notes: value.openingNotes,
        },
      })
      toast.promise(pending, {
        loading: 'Saving opening cash...',
        success: correcting
          ? 'Opening correction saved. Check the closing totals again.'
          : 'Opening cash saved.',
        error: failure,
      })
      try {
        await pending
      } catch {
        return
      }
      setRequestId(crypto.randomUUID())
      form.reset()
    },
  })
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <fieldset disabled={disabled || mutation.isPending} className="space-y-4">
        <NumberField
          form={form}
          name="openingAmount"
          min={0}
          step={0.001}
          format={{ maximumFractionDigits: 3 }}
          label={
            correcting
              ? 'Correct opening amount (BHD)'
              : 'Opening cash counted (BHD)'
          }
        />
        <TextareaField
          form={form}
          name="openingNotes"
          label={
            correcting
              ? 'Reason for correcting opening cash'
              : 'Opening notes (optional)'
          }
        />
        <Button type="submit">
          {mutation.isPending
            ? 'Saving…'
            : correcting
              ? 'Save opening correction'
              : 'Save opening cash'}
        </Button>
      </fieldset>
    </form>
  )
}

export function ExpenseForm({
  report,
  disabled,
}: {
  report: SalesClosing
  disabled: boolean
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const mutation = useTillAction()
  const form = useForm({
    defaultValues: {
      expenseAmount: '' as number | '',
      expensePaymentType: 'cash' as 'cash' | 'benefit' | 'card',
      expenseReason: '',
      expensePaidTo: '',
      expenseReference: '',
    },
    validators: { onSubmit: expenseSchema },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        path: '/sales-closing/expenses',
        body: {
          requestId,
          branchId: report.branchId,
          date: report.date,
          amount: value.expenseAmount,
          paymentType: value.expensePaymentType,
          reason: value.expenseReason,
          paidTo: value.expensePaidTo,
          reference: value.expenseReference,
        },
      })
      toast.promise(pending, {
        loading: 'Recording expense...',
        success: 'Expense recorded. Closing totals updated.',
        error: failure,
      })
      try {
        await pending
      } catch {
        return
      }
      setRequestId(crypto.randomUUID())
      form.reset()
    },
  })
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <fieldset
        disabled={disabled || mutation.isPending || !report.opening}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            form={form}
            name="expenseAmount"
            min={0}
            step={0.001}
            format={{ maximumFractionDigits: 3 }}
            label="Expense amount (BHD)"
          />
          <TextField
            form={form}
            name="expenseReason"
            label="Reason (for example, delivery fee)"
          />
        </div>
        <form.Field name="expensePaymentType">
          {(field) => (
            <Field>
              <span className="text-sm font-medium">Paid by</span>
              <SegmentedOptions
                options={['Cash', 'Benefit', 'Card']}
                value={
                  { cash: 'Cash', benefit: 'Benefit', card: 'Card' }[
                    field.state.value
                  ]
                }
                onChange={(value) =>
                  field.handleChange(
                    value.toLowerCase() as 'cash' | 'benefit' | 'card',
                  )
                }
                columns={3}
                ariaLabel="Expense payment method"
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name="expensePaidTo"
            label="Paid to (optional)"
          />
          <TextField
            form={form}
            name="expenseReference"
            label="Receipt / reference (optional)"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Recorded for {report.branchName} on {report.date}. Cash expenses are
          paid from this drawer. Banked cash and customer refunds must not be
          entered as expenses.
        </p>
        <Button type="submit">
          {mutation.isPending ? 'Recording…' : 'Record paid expense'}
        </Button>
      </fieldset>
    </form>
  )
}

export function VoidExpenseForm({
  expense,
  onClose,
}: {
  expense: BranchExpense
  onClose: () => void
}) {
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useTillAction()
  const form = useForm({
    defaultValues: { voidReason: '' },
    validators: { onSubmit: voidExpenseSchema },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        path: `/sales-closing/expenses/${expense.id}/void`,
        body: { requestId, reason: value.voidReason },
      })
      toast.promise(pending, {
        loading: 'Voiding expense...',
        success: 'Expense voided. The original entry is kept in the history.',
        error: failure,
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
    <form
      className="rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <fieldset disabled={mutation.isPending} className="space-y-3">
        <p className="text-sm font-medium">
          Void {expense.reason} — BHD {formatBhd(expense.amount)}
        </p>
        <TextareaField
          form={form}
          name="voidReason"
          label="Reason for voiding this expense"
        />
        <div className="flex gap-2">
          <Button type="submit">Void expense</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
