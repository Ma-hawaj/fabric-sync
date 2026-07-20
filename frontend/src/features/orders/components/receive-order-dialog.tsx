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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useReceiveOrder } from '../hooks/use-receive-order'
import type { Order, PaymentType } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const paymentTypeOptions: { value: PaymentType; label: string }[] = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

interface ReceiveOrderDialogProps {
  order: Order | null
  onOpenChange: (open: boolean) => void
}

export function ReceiveOrderDialog({
  order,
  onOpenChange,
}: ReceiveOrderDialogProps) {
  const receiveOrder = useReceiveOrder()
  const [paymentType, setPaymentType] = React.useState<PaymentType | ''>('')

  React.useEffect(() => {
    setPaymentType('')
  }, [order?.id])

  const balanceDue = order
    ? Math.max(order.invoiceTotalPrice - order.invoiceAmountPaid, 0)
    : 0

  const handleConfirm = async () => {
    if (!order || !paymentType) return

    const pending = receiveOrder.mutateAsync({ orderId: order.id, paymentType })
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
                <span className="text-muted-foreground">Advance Paid</span>
                <span>
                  {currencyFormatter.format(order.invoiceAdvanceAmount)}
                  {order.invoiceAdvancePaymentType &&
                    ` (${paymentTypeOptions.find((o) => o.value === order.invoiceAdvancePaymentType)?.label})`}
                </span>
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
                ? 'Once every order on this invoice has been received, the remaining balance will be marked as paid in full using the final payment method below.'
                : 'This invoice is already fully paid.'}
            </p>

            <div className="space-y-1">
              <Label htmlFor="final-payment-type">Final Payment Method</Label>
              <Select
                items={paymentTypeOptions}
                value={paymentType}
                onValueChange={(value: PaymentType) => setPaymentType(value)}
              >
                <SelectTrigger id="final-payment-type" className="w-full">
                  <SelectValue placeholder="Select payment method..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={receiveOrder.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!paymentType || receiveOrder.isPending}
              >
                Confirm Received
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
