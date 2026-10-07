import { useForm } from '@tanstack/react-form'
import * as React from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NumberField } from '@/components/form/fields'
import { ApiError } from '@/lib/api'
import { useRemoveStock } from '../hooks/use-remove-stock'
import {
  createRemoveStockForm,
  removeStockSchema,
} from '../lib/remove-stock-schema'
import type { Material } from '../types/inventory'

interface RemoveStockDialogProps {
  material: Material | null
  onOpenChange: (open: boolean) => void
}

export function RemoveStockDialog({
  material,
  onOpenChange,
}: RemoveStockDialogProps) {
  return (
    <Dialog
      open={material !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent>
        {material && (
          <>
            <DialogHeader>
              <DialogTitle>Remove Stock</DialogTitle>
              <DialogDescription>
                {material.sku
                  ? `${material.name} (${material.sku})`
                  : material.name}
              </DialogDescription>
            </DialogHeader>

            {/* Remounted per material so the rows always start blank for the
                material on screen. */}
            <RemoveStockForm
              key={material.id}
              material={material}
              onClose={() => onOpenChange(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RemoveStockForm({
  material,
  onClose,
}: {
  material: Material
  onClose: () => void
}) {
  const removeStock = useRemoveStock()

  // The schema caps each row at its location's live quantity, so it is built
  // from the material on screen.
  const available = React.useMemo(
    () =>
      Object.fromEntries(
        material.locations.map((stock) => [stock.locationId, stock.quantity]),
      ),
    [material],
  )

  const form = useForm({
    defaultValues: createRemoveStockForm(material),
    validators: { onSubmit: removeStockSchema(available) },
    onSubmit: async ({ value }) => {
      const entries = value.entries.flatMap((entry) =>
        entry.quantity === '' || entry.quantity <= 0
          ? []
          : [{ locationId: entry.locationId, quantity: entry.quantity }],
      )

      const pending = removeStock.mutateAsync({
        materialId: material.id,
        entries,
      })
      toast.promise(pending, {
        loading: 'Removing stock...',
        success: 'Stock removed.',
        error: (e) =>
          e instanceof ApiError ? e.message : 'Could not remove this stock.',
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
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
      className="space-y-4"
    >
      <p className="text-sm text-muted-foreground">
        Takes stock off without deleting the material — wastage, samples, or a
        correction. The material itself stays.
      </p>

      <form.Field name="entries">
        {(entriesField) => (
          <div className="space-y-3">
            {entriesField.state.value.map((entry, index) => {
              const stock = material.locations[index]
              return (
                <div key={entry.locationId} className="flex items-end gap-3">
                  <div className="flex-1 pb-1">
                    <div className="text-sm font-medium">{stock.location}</div>
                    <div className="text-xs text-muted-foreground">
                      Available: {stock.quantity} {material.unit}
                    </div>
                  </div>
                  <div className="w-32">
                    <NumberField
                      form={form}
                      name={`entries[${index}].quantity`}
                      label="Remove"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => [state.submissionAttempts, state.isValid] as const}
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={removeStock.isPending}>
          Remove Stock
        </Button>
      </DialogFooter>
    </form>
  )
}
