import { useForm } from '@tanstack/react-form'
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
import { NumberField, SelectField, TextField } from '@/components/form/fields'
import { ApiError } from '@/lib/api'
import { CURRENCY } from '@/lib/currency'
import {
  JUNIOR_BELOW_METRES,
  LARGE_ABOVE_METRES,
} from '@/features/invoices/lib/garment-pricing'
import { UNITS } from '../data/inventory-options'
import {
  materialEditSchema,
  materialEditValues,
} from '../lib/material-edit-schema'
import { useUpdateMaterial } from '../hooks/use-update-material'
import type { Material } from '../types/inventory'

export function EditMaterialDialog({
  material,
  onOpenChange,
}: {
  material: Material | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog
      open={material !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {material && (
          <>
            <DialogHeader>
              <DialogTitle>Edit Material</DialogTitle>
              <DialogDescription>{material.name}</DialogDescription>
            </DialogHeader>
            <EditMaterialForm
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

function EditMaterialForm({
  material,
  onClose,
}: {
  material: Material
  onClose: () => void
}) {
  const mutation = useUpdateMaterial()
  const form = useForm({
    defaultValues: materialEditValues(material),
    validators: { onSubmit: materialEditSchema },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        materialId: material.id,
        values: value,
      })
      toast.promise(pending, {
        loading: 'Saving material...',
        success: 'Material saved.',
        error: (error) =>
          error instanceof ApiError
            ? error.message
            : 'Could not save this material.',
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
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField form={form} name="name" label="Name" />
        <TextField form={form} name="sku" label="SKU" />
      </div>
      <TextField form={form} name="family" label="Family" />
      <SelectField
        form={form}
        name="unit"
        label="Unit"
        options={Array.from(new Set([...UNITS, material.unit]))}
      />
      <div className="space-y-3">
        <p className="text-sm font-medium">
          Garment prices incl. VAT ({CURRENCY})
        </p>
        <p className="text-xs text-muted-foreground">
          Junior below {JUNIOR_BELOW_METRES} m; normal {JUNIOR_BELOW_METRES}–
          {LARGE_ABOVE_METRES} m inclusive; large above {LARGE_ABOVE_METRES} m.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField form={form} name="juniorPrice" label="Junior price" />
          <NumberField form={form} name="normalPrice" label="Normal price" />
          <NumberField form={form} name="largePrice" label="Large price" />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          Save Material
        </Button>
      </DialogFooter>
    </form>
  )
}
