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
import { useReceiveOrder } from '../hooks/use-receive-order'
import type { Order } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

interface ReceiveOrderDialogProps {
  order: Order | null
  onOpenChange: (open: boolean) => void
}

export function ReceiveOrderDialog({
  order,
  onOpenChange,
}: ReceiveOrderDialogProps) {
  const receiveOrder = useReceiveOrder()

  const balanceDue = order
    ? Math.max(order.invoiceTotalPrice - order.invoiceAmountPaid, 0)
    : 0

  const handleConfirm = async () => {
    if (!order) return

    const pending = receiveOrder.mutateAsync(order.id)
    toast.promise(pending, {
      loading: 'Marking order received...',
      success: 'Order marked received.',
      error: 'Could not update this order. Please try again.',
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
              <DialogTitle>Mark Order Received</DialogTitle>
              <DialogDescription>
                {order.customerName} — {order.materialName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Total</span>
                <span>{currencyFormatter.format(order.invoiceTotalPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Paid</span>
                <span>{currencyFormatter.format(order.invoiceAmountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Remaining Balance</span>
                <span>{currencyFormatter.format(balanceDue)}</span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {balanceDue > 0
                ? 'Once every order on this invoice has been received, the remaining balance will be marked as paid in full.'
                : 'This invoice is already fully paid.'}
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={receiveOrder.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={receiveOrder.isPending}>
                Confirm Received
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
