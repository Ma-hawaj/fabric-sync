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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldError } from '@/components/ui/field'
import { CURRENCY } from '@/lib/currency'
import { useReceiveOrder } from '../hooks/use-receive-order'
import type { Order, PaymentType } from '../types/orders'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
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
  const [amount, setAmount] = React.useState('')
  const [paymentType, setPaymentType] = React.useState<PaymentType | ''>('')

  // Prefill this pickup with the whole remaining balance — staff collecting
  // the last order usually settle everything, and a partial pickup just edits
  // the figure down.
  React.useEffect(() => {
    setAmount(
      order && order.invoiceBalanceDue > 0
        ? String(order.invoiceBalanceDue)
        : '',
    )
    setPaymentType('')
  }, [order?.id])

  const parsedAmount = amount === '' ? 0 : Number(amount)
  const amountValid =
    amount === '' || (!Number.isNaN(parsedAmount) && parsedAmount >= 0)
  const overBalance =
    amountValid && order ? parsedAmount - order.invoiceBalanceDue > 1e-9 : false
  const needsMethod = parsedAmount > 0

  const canConfirm =
    order &&
    amountValid &&
    !overBalance &&
    (!needsMethod || paymentType) &&
    !receiveOrder.isPending

  const handleConfirm = async () => {
    if (!order || !canConfirm) return

    const pending = receiveOrder.mutateAsync({
      orderId: order.id,
      amount: parsedAmount,
      paymentType: needsMethod ? (paymentType as PaymentType) : null,
    })
    toast.promise(pending, {
      loading: 'Marking order received...',
      success:
        parsedAmount > 0
          ? 'Order marked received and payment recorded.'
          : 'Order marked received.',
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
                {order.customerName} — {order.material}
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
                <span>{currencyFormatter.format(order.invoiceBalanceDue)}</span>
              </div>
            </div>

            <Field data-invalid={!amountValid || overBalance}>
              <Label htmlFor="pickup-amount">Collected Now ({CURRENCY})</Label>
              <Input
                id="pickup-amount"
                inputMode="decimal"
                placeholder="0.000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <FieldError
                errors={
                  !amountValid
                    ? [{ message: 'Enter a valid amount.' }]
                    : overBalance
                      ? [
                          {
                            message:
                              'More than the invoice\u2019s remaining balance.',
                          },
                        ]
                      : []
                }
              />
            </Field>

            {needsMethod && (
              <div className="space-y-1">
                <Label htmlFor="pickup-payment-type">Payment Method</Label>
                <Select
                  items={paymentTypeOptions}
                  value={paymentType}
                  onValueChange={(value: PaymentType) => setPaymentType(value)}
                >
                  <SelectTrigger id="pickup-payment-type" className="w-full">
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
            )}

            <p className="text-sm text-muted-foreground">
              {order.invoiceBalanceDue > 0
                ? 'The invoice is settled in full once every order on it has been received and the balance reaches zero.'
                : 'This invoice is already fully paid — this just collects the garment.'}
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={receiveOrder.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                Confirm Received
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
