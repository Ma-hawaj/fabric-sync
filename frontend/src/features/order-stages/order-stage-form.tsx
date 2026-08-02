import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NumberField, TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { useCreateOrderStage } from './hooks/use-create-order-stage'
import { useOrderStages } from './hooks/use-order-stages'
import { useUpdateOrderStage } from './hooks/use-update-order-stage'
import { orderStageFormSchema } from './lib/order-stage-schema'
import {
  createEmptyOrderStageForm,
  orderStageToFormValues,
} from './types/order-stage-form'
import type { OrderStage } from './types/order-stage'

const EVERY_ORDER = 'Every order'
const DELIVERIES_ONLY = 'Only when delivering'
const APPLIES_OPTIONS = [EVERY_ORDER, DELIVERIES_ONLY] as const

export function OrderStageFormPage({ stageId }: { stageId?: string }) {
  const { data: stages = [], isLoading } = useOrderStages()
  const existing = stageId
    ? stages.find((stage) => stage.id === stageId)
    : undefined

  if (stageId && isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading stage...
      </div>
    )
  }

  if (stageId && !existing) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        That stage could not be found.
      </div>
    )
  }

  // Keyed so the form re-initialises if the underlying stage changes —
  // defaultValues is only read on the first render.
  return <OrderStageForm key={existing?.id ?? 'new'} existing={existing} />
}

function OrderStageForm({ existing }: { existing?: OrderStage }) {
  const navigate = useNavigate()
  const createStage = useCreateOrderStage()
  const updateStage = useUpdateOrderStage()
  const mutation = existing ? updateStage : createStage

  const form = useForm({
    defaultValues: existing
      ? orderStageToFormValues(existing)
      : createEmptyOrderStageForm(),
    validators: { onSubmit: orderStageFormSchema },
    onSubmit: async ({ value }) => {
      const pending = existing
        ? updateStage.mutateAsync({
            id: existing.id,
            name: value.name,
            sortOrder: Number(value.sortOrder),
            requiresDelivery: value.requiresDelivery,
            isActive: value.isActive,
          })
        : createStage.mutateAsync(value)

      toast.promise(pending, {
        loading: existing ? 'Saving stage...' : 'Adding stage...',
        success: (stage) =>
          existing ? `${stage.name} was updated.` : `${stage.name} was added.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'A stage with this name already exists.'
            : 'Could not save this stage. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/order-stages' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? 'Edit Stage' : 'Add Stage'}
        </h1>
        <p className="text-muted-foreground">
          Stages are shared by every order and every repair. Changing this list
          takes effect on work already in progress.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-xl space-y-6"
      >
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <TextField form={form} name="name" label="Stage Name" />
          <NumberField form={form} name="sortOrder" label="Position" />

          <form.Field name="requiresDelivery">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Applies To</FieldLabel>
                <SegmentedOptions
                  id={field.name}
                  options={APPLIES_OPTIONS}
                  value={field.state.value ? DELIVERIES_ONLY : EVERY_ORDER}
                  onChange={(label) =>
                    field.handleChange(label === DELIVERIES_ONLY)
                  }
                  columns={2}
                />
                <p className="text-xs text-muted-foreground">
                  A delivery stage is skipped automatically on orders produced
                  at the same location the customer collects from.
                </p>
              </Field>
            )}
          </form.Field>

          {existing && (
            <form.Field name="isActive">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Status</FieldLabel>
                  <SegmentedOptions
                    id={field.name}
                    options={['Active', 'Retired']}
                    value={field.state.value ? 'Active' : 'Retired'}
                    onChange={(label) => field.handleChange(label === 'Active')}
                    columns={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Retired stages drop off the checklist, except on orders that
                    already recorded them.
                  </p>
                </Field>
              )}
            </form.Field>
          )}
        </div>

        <form.Subscribe
          selector={(state) =>
            [state.submissionAttempts, state.isValid] as const
          }
        >
          {([submissionAttempts, isValid]) =>
            submissionAttempts > 0 &&
            !isValid && (
              <p className="text-sm font-medium text-destructive">
                Please fix the highlighted fields before saving.
              </p>
            )
          }
        </form.Subscribe>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/order-stages' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
