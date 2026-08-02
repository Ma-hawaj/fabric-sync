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
import { Textarea } from '@/components/ui/textarea'
import { CURRENCY } from '@/lib/currency'
import { useCreateRepair } from '../hooks/use-create-repair'
import type { Order } from '../types/orders'

interface LogRepairDialogProps {
  order: Order | null
  onOpenChange: (open: boolean) => void
}

export function LogRepairDialog({ order, onOpenChange }: LogRepairDialogProps) {
  const createRepair = useCreateRepair()
  const [reason, setReason] = React.useState('')
  const [charge, setCharge] = React.useState('')
  const [notes, setNotes] = React.useState('')

  React.useEffect(() => {
    setReason('')
    setCharge('')
    setNotes('')
  }, [order?.id])

  const handleConfirm = async () => {
    if (!order || !reason.trim()) return

    const pending = createRepair.mutateAsync({
      orderId: order.id,
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
      <DialogContent>
        {order && (
          <>
            <DialogHeader>
              <DialogTitle>Log Repair</DialogTitle>
              <DialogDescription>
                {order.customerName} — {order.material}
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm text-muted-foreground">
              The repair gets its own pass through the stage checklist, so
              earlier repairs on this order stay on record.
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

            <DialogFooter>
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
