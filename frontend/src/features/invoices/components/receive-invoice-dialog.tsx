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

  const balanceDue = invoice
    ? Math.max(invoice.totalPrice - invoice.amountPaid, 0)
    : 0

  const handleConfirm = async () => {
    if (!invoice || !paymentType) return

    const pending = receiveInvoice.mutateAsync({
      invoiceId: invoice.id,
      paymentType,
    })
    toast.promise(pending, {
      loading: 'Marking invoice received...',
      success: 'Invoice marked received.',
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">Advance Paid</span>
                <span>
                  {currencyFormatter.format(invoice.advanceAmount)}
                  {invoice.advancePaymentType &&
                    ` (${paymentTypeOptions.find((o) => o.value === invoice.advancePaymentType)?.label})`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Paid</span>
                <span>{currencyFormatter.format(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Remaining Balance</span>
                <span>{currencyFormatter.format(balanceDue)}</span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {balanceDue > 0
                ? 'Marks every order on this invoice received and settles the remaining balance in full using the final payment method below.'
                : 'This invoice is already fully paid.'}
            </p>

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

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={receiveInvoice.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!paymentType || receiveInvoice.isPending}
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
