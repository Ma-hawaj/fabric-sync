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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldError } from '@/components/ui/field'
import { ApiError } from '@/lib/api'
import { useRemoveStock } from '../hooks/use-remove-stock'
import type { Material } from '../types/inventory'

interface RemoveStockDialogProps {
  material: Material | null
  onOpenChange: (open: boolean) => void
}

export function RemoveStockDialog({
  material,
  onOpenChange,
}: RemoveStockDialogProps) {
  const removeStock = useRemoveStock()
  const [amounts, setAmounts] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    setAmounts({})
  }, [material?.id])

  const setAmount = (locationId: string, value: string) =>
    setAmounts((prev) => ({ ...prev, [locationId]: value }))

  // One validity check per location row: blank means "leave it", otherwise a
  // positive number no bigger than what the location holds.
  const rowState = (locationId: string, available: number) => {
    const raw = amounts[locationId] ?? ''
    if (raw === '') return { amount: 0, error: null as string | null }
    const parsed = Number(raw)
    if (Number.isNaN(parsed) || parsed <= 0) {
      return { amount: 0, error: 'Enter a quantity greater than 0.' }
    }
    if (parsed - available > 1e-9) {
      return { amount: 0, error: 'More than this location holds.' }
    }
    return { amount: parsed, error: null as string | null }
  }

  const states =
    material?.locations.map((stock) => ({
      stock,
      ...rowState(stock.locationId, stock.quantity),
    })) ?? []
  const removable = states.filter((row) => row.amount > 0)
  const canConfirm =
    material &&
    removable.length > 0 &&
    states.every((row) => row.error === null) &&
    !removeStock.isPending

  const handleConfirm = async () => {
    if (!material || removable.length === 0 || removeStock.isPending) return
    if (states.some((row) => row.error !== null)) return

    const pending = removeStock.mutateAsync({
      materialId: material.id,
      entries: removable.map((row) => ({
        locationId: row.stock.locationId,
        quantity: row.amount,
      })),
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
    onOpenChange(false)
  }

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

            <p className="text-sm text-muted-foreground">
              Takes stock off without deleting the material — wastage, samples,
              or a correction. The material itself stays.
            </p>

            <div className="space-y-3">
              {states.map((row) => (
                <Field key={row.stock.locationId} data-invalid={!!row.error}>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {row.stock.location}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Available: {row.stock.quantity} {material.unit}
                      </div>
                    </div>
                    <div className="w-32">
                      <Label htmlFor={`remove-${row.stock.locationId}`}>
                        Remove
                      </Label>
                      <Input
                        id={`remove-${row.stock.locationId}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={amounts[row.stock.locationId] ?? ''}
                        onChange={(e) =>
                          setAmount(row.stock.locationId, e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <FieldError
                    errors={row.error ? [{ message: row.error }] : []}
                  />
                </Field>
              ))}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={removeStock.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                Remove Stock
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
