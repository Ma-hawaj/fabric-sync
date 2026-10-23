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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NumberField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { stockLocations } from '@/features/locations/lib/location-filters'
import type { Location } from '@/features/locations/types/location'
import { useTransferStock } from '../hooks/use-transfer-stock'
import { transferStockSchema } from '../lib/transfer-stock-schema'
import type { Material } from '../types/inventory'

export function TransferStockDialog({
  material,
  locations,
  onOpenChange,
}: {
  material: Material | null
  locations: Location[]
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog
      open={material !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent>
        {material && (
          <>
            <DialogHeader>
              <DialogTitle>Move Stock</DialogTitle>
              <DialogDescription>{material.name}</DialogDescription>
            </DialogHeader>
            <TransferStockForm
              key={material.id}
              material={material}
              locations={locations}
              onClose={() => onOpenChange(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TransferStockForm({
  material,
  locations,
  onClose,
}: {
  material: Material
  locations: Location[]
  onClose: () => void
}) {
  const mutation = useTransferStock()
  const sources = material.locations.filter((stock) => stock.quantity > 0)
  const destinations = stockLocations(locations)
  const available = Object.fromEntries(
    sources.map((stock) => [stock.locationId, stock.quantity]),
  )
  const form = useForm({
    defaultValues: {
      fromLocationId: sources[0]?.locationId ?? '',
      toLocationId: '',
      quantity: '' as number | '',
    },
    validators: {
      onSubmit: transferStockSchema(
        available,
        destinations.map((location) => location.id),
      ),
    },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        materialId: material.id,
        ...value,
        quantity: Number(value.quantity),
      })
      toast.promise(pending, {
        loading: 'Moving stock...',
        success: 'Stock moved.',
        error: (error) =>
          error instanceof ApiError
            ? error.message
            : 'Could not move this stock.',
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
      <p className="text-sm text-muted-foreground">
        Move stock between locations. The material’s total quantity stays the
        same.
      </p>
      <form.Field name="fromLocationId">
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name}>From location</FieldLabel>
            <Select
              items={sources.map((stock) => ({
                value: stock.locationId,
                label: `${stock.location} (${stock.quantity} ${material.unit})`,
              }))}
              value={field.state.value}
              onValueChange={(value) => {
                field.handleChange(value ?? '')
                if (value === form.state.values.toLocationId)
                  form.setFieldValue('toLocationId', '')
              }}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue placeholder="Pick source..." />
              </SelectTrigger>
              <SelectContent>
                {sources.map((stock) => (
                  <SelectItem key={stock.locationId} value={stock.locationId}>
                    {stock.location} ({stock.quantity} {material.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.fromLocationId}>
        {(source) => (
          <>
            <form.Field name="toLocationId">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={field.name}>To location</FieldLabel>
                  <Select
                    items={destinations
                      .filter((location) => location.id !== source)
                      .map((location) => ({
                        value: location.id,
                        label: location.name,
                      }))}
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value ?? '')}
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue placeholder="Pick destination..." />
                    </SelectTrigger>
                    <SelectContent>
                      {destinations
                        .filter((location) => location.id !== source)
                        .map((location) => (
                          <SelectItem key={location.id} value={location.id}>
                            {location.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <p className="text-xs text-muted-foreground">
              Available at source: {available[source] ?? 0} {material.unit}
            </p>
            {!destinations.some((location) => location.id !== source) && (
              <p className="text-sm text-muted-foreground">
                No other active stock location is available.
              </p>
            )}
          </>
        )}
      </form.Subscribe>
      <NumberField
        form={form}
        name="quantity"
        label="Quantity to move"
        unit={material.unit}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          Move Stock
        </Button>
      </DialogFooter>
    </form>
  )
}
