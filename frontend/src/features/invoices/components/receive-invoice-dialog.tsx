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
import { CURRENCY } from '@/lib/currency'
import { useReceiveInvoice } from '../hooks/use-receive-invoice'
import type { Invoice, PaymentType } from '../types/invoices'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

const paymentTypeOptions: { value: PaymentType; label: string }[] = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

interface ReceiveInvoiceDialogProps {
  invoice: Invoice | null
  onOpenChange: (open: boolean) => void
}

export function ReceiveInvoiceDialog({
  invoice,
  onOpenChange,
}: ReceiveInvoiceDialogProps) {
  const receiveInvoice = useReceiveInvoice()
  const [paymentType, setPaymentType] = React.useState<PaymentType | ''>('')

  React.useEffect(() => {
    setPaymentType('')
  }, [invoice?.id])

  // No money changes hands when nothing is left to pay — the method picker
  // stays hidden and the request carries a null payment type.
  const needsPayment = (invoice?.balanceDue ?? 0) > 0
  const canConfirm =
    invoice && (!needsPayment || paymentType) && !receiveInvoice.isPending

  const handleConfirm = async () => {
    if (!invoice || !canConfirm) return

    const pending = receiveInvoice.mutateAsync({
      invoiceId: invoice.id,
      paymentType: needsPayment ? (paymentType as PaymentType) : null,
    })
    toast.promise(pending, {
      loading: 'Marking invoice received...',
      success: needsPayment
        ? 'Invoice marked received and settled.'
        : 'Invoice marked received.',
      error: 'Could not update this invoice. Please try again.',
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
      open={invoice !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent>
        {invoice && (
          <>
            <DialogHeader>
              <DialogTitle>Mark Invoice Received</DialogTitle>
              <DialogDescription>
                {invoice.customers.map((c) => c.name).join(', ')} —{' '}
                {invoice.materials.join(', ')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Total</span>
                <span>{currencyFormatter.format(invoice.totalPrice)}</span>
              </div>
              {invoice.giftCardRedeemed > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Paid by gift card
                  </span>
                  <span>
                    {currencyFormatter.format(invoice.giftCardRedeemed)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Paid</span>
                <span>{currencyFormatter.format(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Remaining Balance</span>
                <span>{currencyFormatter.format(invoice.balanceDue)}</span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {needsPayment
                ? 'Marks every order on this invoice received and settles the remaining balance in full using the payment method below.'
                : 'This invoice is already fully paid — this just collects every order on it.'}
            </p>

            {needsPayment && (
              <div className="space-y-1">
                <Label htmlFor="invoice-final-payment-type">
                  Final Payment Method
                </Label>
                <Select
                  items={paymentTypeOptions}
                  value={paymentType}
                  onValueChange={(value: PaymentType) => setPaymentType(value)}
                >
                  <SelectTrigger
                    id="invoice-final-payment-type"
                    className="w-full"
                  >
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

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={receiveInvoice.isPending}
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
