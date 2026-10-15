import * as React from 'react'
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
import {
  MeasurementFields,
  measurementFromSnapshot,
} from '@/features/customers/components/measurement-fields'
import { createEmptyMeasurement } from '@/features/customers/types/measurement-form'
import { useOrder } from '../hooks/use-order'
import { useFixRepairMeasurement } from '../hooks/use-fix-repair-measurement'
import type { RepairListItem } from '../types/orders'

interface FixRepairMeasurementDialogProps {
  repair: RepairListItem | null
  onOpenChange: (open: boolean) => void
}

export function FixRepairMeasurementDialog({
  repair,
  onOpenChange,
}: FixRepairMeasurementDialogProps) {
  return (
    <Dialog
      open={repair !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent className="max-w-3xl">
        {repair && (
          <FixRepairMeasurementForm
            key={repair.id}
            repair={repair}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// Split out so the form is keyed by repair: defaultValues are only read on
// the first render, and the snapshot below arrives async.
function FixRepairMeasurementForm({
  repair,
  onDone,
  onCancel,
}: {
  repair: RepairListItem
  onDone: () => void
  onCancel: () => void
}) {
  const { data: order, isLoading } = useOrder(repair.orderId)
  const fixMeasurement = useFixRepairMeasurement()

  const form = useForm({
    defaultValues: {
      measurement: createEmptyMeasurement(),
    },
    onSubmit: async ({ value }) => {
      const pending = fixMeasurement.mutateAsync({
        orderId: repair.orderId,
        repairId: repair.id,
        measurement: value.measurement,
      })
      toast.promise(pending, {
        loading: 'Recording measurement fix...',
        success: 'Measurement fix recorded for future orders.',
        error: 'Could not record this fix. Please try again.',
      })
      try {
        await pending
      } catch {
        return
      }
      onDone()
    },
  })

  // Prefill from the garment's cut-to snapshot once it loads — the fix starts
  // from what the tailor cut, and staff edit what the repair changed. Saving
  // always inserts a new dated row (see measurementFromSnapshot); the order's
  // own snapshot never moves.
  const snapshotId = order?.measurement.id ?? null
  const reset = form.reset
  React.useEffect(() => {
    if (order) {
      reset({
        measurement: measurementFromSnapshot(order.measurement),
      })
    }
  }, [order, reset, snapshotId])

  if (isLoading || !order) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Loading measurements...
      </p>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record Measurement Fix</DialogTitle>
        <DialogDescription>
          {repair.customerName} — ORD-{repair.orderNumber} · {repair.reason}
        </DialogDescription>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">
        Starts from the measurements this garment was cut to. Change what the
        repair fixed — the fix is saved as a new record for future orders.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="space-y-4"
      >
        <MeasurementFields
          form={form}
          basePath="measurement"
          history={[order.measurement]}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={fixMeasurement.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={fixMeasurement.isPending}>
            Save Fix
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
