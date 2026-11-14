import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { PermissionGuard } from '@/components/permission-guard'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { TextareaField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { StaffName } from '@/features/users/components/staff-name'
import { ISSUING_BRANCH_FILTERS } from '@/features/locations/lib/location-filters'
import type { Location } from '@/features/locations/types/location'
import { useAssignFinancialBranch } from '../hooks/use-assign-financial-branch'
import { financialBranchSchema } from '../lib/financial-branch-schema'
import type { FinancialBranch } from '../types/invoice-detail'

export function FinancialBranchPanel({
  invoiceId,
  branch,
}: {
  invoiceId: string
  branch?: FinancialBranch
}) {
  if (!branch) return null
  if (branch.assignedAt)
    return (
      <div className="rounded-xl border p-4 text-sm">
        <p>Financial branch: {branch.branchName}</p>
        <p>
          Assigned by <StaffName userId={branch.assignedBy} /> ·{' '}
          {new Date(branch.assignedAt).toLocaleString()}
        </p>
        <p className="whitespace-pre-wrap">{branch.reason}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Earlier activity stays unassigned. This branch handles subsequent
          payments and refunds.
        </p>
      </div>
    )
  if (branch.branchId) return null
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <p className="text-sm">
        This invoice has no financial branch. A manager must assign one before
        new payments, refunds or adjustments.
      </p>
      <PermissionGuard
        method="POST"
        path={`/invoices/${invoiceId}/financial-branch`}
      >
        <AssignBranchForm invoiceId={invoiceId} />
      </PermissionGuard>
    </section>
  )
}

function AssignBranchForm({ invoiceId }: { invoiceId: string }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useAssignFinancialBranch(invoiceId)
  const form = useForm({
    defaultValues: { branchId: '', reason: '' },
    validators: { onSubmit: financialBranchSchema },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({ ...value, requestId })
      toast.promise(pending, {
        loading: 'Assigning financial branch...',
        success: 'Financial branch assigned.',
        error: (error) =>
          error instanceof ApiError
            ? error.message
            : 'Could not confirm assignment. Refresh the invoice before retrying.',
      })
      try {
        await pending
      } catch {
        return
      }
    },
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Choose the branch responsible for future financial activity. Its daily
          opening and closing checks apply. This assignment is permanent;
          earlier activity and saved reports stay unchanged.
        </p>
        <form.Field name="branchId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="financial-branch">
                Financial branch
              </FieldLabel>
              <AsyncCombobox<Location>
                id="financial-branch"
                endpoint="/locations"
                queryKey="invoice-issuing-branch"
                searchField="name"
                value={field.state.value || null}
                onValueChange={(value) => field.handleChange(value ?? '')}
                toOption={(location) => ({
                  value: location.id,
                  label: location.name,
                })}
                filters={ISSUING_BRANCH_FILTERS}
                placeholder="Choose a financial branch"
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <TextareaField
          form={form}
          name="reason"
          label="Reason for assigning this branch"
        />
        <Button type="submit">
          {mutation.isPending ? 'Assigning…' : 'Assign financial branch'}
        </Button>
      </fieldset>
    </form>
  )
}
