import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import {
  MeasurementFields,
  measurementFromSnapshot,
} from '@/features/customers/components/measurement-fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import {
  MEASUREMENT_TYPES,
  MEASUREMENT_FITS,
} from '@/features/customers/types/measurement-form'
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
import { Textarea } from '@/components/ui/textarea'
import { CURRENCY } from '@/lib/currency'
import { useCreateRepair } from '../hooks/use-create-repair'
import type { OrderDetail } from '../types/orders'

interface LogRepairDialogProps {
  order: OrderDetail | null
  onOpenChange: (open: boolean) => void
}

export function LogRepairDialog({ order, onOpenChange }: LogRepairDialogProps) {
  const createRepair = useCreateRepair()
  const [reason, setReason] = React.useState('')
  const [charge, setCharge] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [updateMeasurement, setUpdateMeasurement] = React.useState(false)
  const [measurementError, setMeasurementError] = React.useState('')
  const form = useForm({
    defaultValues: {
      measurement: measurementFromSnapshot(order?.measurement ?? null),
    },
  })
  const resetMeasurement = form.reset

  React.useEffect(() => {
    setReason('')
    setCharge('')
    setNotes('')
    setUpdateMeasurement(false)
    setMeasurementError('')
    resetMeasurement({
      measurement: measurementFromSnapshot(order?.measurement ?? null),
    })
  }, [order?.id, resetMeasurement])

  const handleConfirm = async () => {
    if (!order || !reason.trim()) return

    const measurement = form.state.values.measurement
    if (
      updateMeasurement &&
      (!MEASUREMENT_TYPES.includes(
        measurement.type as (typeof MEASUREMENT_TYPES)[number],
      ) ||
        !MEASUREMENT_FITS.includes(
          measurement.fit as (typeof MEASUREMENT_FITS)[number],
        ))
    ) {
      setMeasurementError('Pick a measurement type and fit before saving.')
      return
    }
    setMeasurementError('')
    const pending = createRepair.mutateAsync({
      orderId: order.id,
      measurement: updateMeasurement ? measurement : undefined,
      reason: reason.trim(),
      charge: charge === '' ? 0 : Number(charge),
      notes: notes.trim() || undefined,
    })
    toast.promise(pending, {
      loading: 'Logging repair...',
      success: 'Repair logged.',
      error: 'Could not log this repair. Please try again.',
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
      open={order !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent
        className={`flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden ${updateMeasurement ? 'sm:max-w-6xl' : 'sm:max-w-xl'}`}
      >
        {order && (
          <>
            <DialogHeader className="shrink-0">
              <DialogTitle>Log Repair</DialogTitle>
              <DialogDescription>
                {order.customerName} — {order.material}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 space-y-4 overflow-y-auto px-1">
              <p className="text-sm text-muted-foreground">
                The repair is tracked by its own record and status, so earlier
                repairs on this order stay on record.
              </p>

              <div className="space-y-1">
                <Label htmlFor="repair-reason">Reason</Label>
                <Input
                  id="repair-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What needs putting right?"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="repair-charge">Charge ({CURRENCY})</Label>
                <Input
                  id="repair-charge"
                  type="number"
                  min="0"
                  step="0.01"
                  value={charge}
                  onChange={(e) => setCharge(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground">
                  Leave at zero for rework done free of charge. This is recorded
                  against the repair, not billed to the invoice.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="repair-notes">Notes</Label>
                <Textarea
                  id="repair-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-3 rounded-xl border p-4">
                <Label>Update measurements for this repair?</Label>
                <SegmentedOptions
                  ariaLabel="Update measurements for this repair?"
                  options={['No changes', 'Update measurements']}
                  value={
                    updateMeasurement ? 'Update measurements' : 'No changes'
                  }
                  onChange={(value) =>
                    setUpdateMeasurement(value === 'Update measurements')
                  }
                  columns={2}
                />
                {updateMeasurement && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Start from this garment’s measurements and change what
                      needs correcting. These measurements will be saved for
                      future orders.
                    </p>
                    <MeasurementFields
                      form={form}
                      basePath="measurement"
                      history={[order.measurement]}
                    />
                    {measurementError && (
                      <p role="alert" className="text-sm text-destructive">
                        {measurementError}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createRepair.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!reason.trim() || createRepair.isPending}
              >
                Log Repair
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
